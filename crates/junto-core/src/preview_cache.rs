use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::Mutex;

use crate::media::MediaKind;
use crate::paths::normalize_project_relative_path;
use crate::thumbnail::frame_jpeg_cached;

const DEFAULT_CAPACITY: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PreviewCacheKey {
    pub relative_path: String,
    pub bucket_ms: i64,
    pub max_height: u32,
    pub is_image: bool,
}

impl PreviewCacheKey {
    pub fn for_source(
        project_root: &Path,
        relative_source: &str,
        time_seconds: f64,
        max_height: u32,
        kind: MediaKind,
    ) -> Self {
        let relative = normalize_project_relative_path(project_root, relative_source);
        let is_image = matches!(kind, MediaKind::Image);
        let bucket_ms = if is_image {
            0
        } else {
            (time_seconds.max(0.0) * 10.0).round() as i64
        };
        Self {
            relative_path: relative,
            bucket_ms,
            max_height,
            is_image,
        }
    }
}

#[derive(Debug, Default)]
struct LruInner {
    map: HashMap<PreviewCacheKey, Vec<u8>>,
    order: VecDeque<PreviewCacheKey>,
    capacity: usize,
}

impl LruInner {
    fn new(capacity: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    fn get(&mut self, key: &PreviewCacheKey) -> Option<Vec<u8>> {
        if let Some(bytes) = self.map.get(key) {
            if let Some(pos) = self.order.iter().position(|k| k == key) {
                if let Some(k) = self.order.remove(pos) {
                    self.order.push_back(k);
                }
            }
            return Some(bytes.clone());
        }
        None
    }

    fn insert(&mut self, key: PreviewCacheKey, bytes: Vec<u8>) {
        if self.map.contains_key(&key) {
            self.map.insert(key.clone(), bytes);
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                if let Some(k) = self.order.remove(pos) {
                    self.order.push_back(k);
                }
            }
            return;
        }
        while self.map.len() >= self.capacity {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            } else {
                break;
            }
        }
        self.order.push_back(key.clone());
        self.map.insert(key, bytes);
    }
}

static MEMORY_CACHE: Mutex<Option<LruInner>> = Mutex::new(None);

fn with_cache<R>(f: impl FnOnce(&mut LruInner) -> R) -> R {
    let mut guard = MEMORY_CACHE.lock().expect("preview cache lock");
    if guard.is_none() {
        *guard = Some(LruInner::new(DEFAULT_CAPACITY));
    }
    f(guard.as_mut().expect("cache initialized"))
}

/// Return JPEG bytes from memory cache, disk cache, or ffmpeg extract.
pub fn frame_jpeg_cached_hot(
    project_root: &Path,
    relative_source: &str,
    absolute_source: &Path,
    time_seconds: f64,
    max_height: u32,
) -> crate::Result<Vec<u8>> {
    let kind = MediaKind::from_path(absolute_source).unwrap_or(MediaKind::Video);
    let key = PreviewCacheKey::for_source(
        project_root,
        relative_source,
        time_seconds,
        max_height,
        kind,
    );

    if let Some(bytes) = with_cache(|c| c.get(&key)) {
        return Ok(bytes);
    }

    let jpeg = frame_jpeg_cached(
        project_root,
        relative_source,
        absolute_source,
        if key.is_image { 0.0 } else { time_seconds },
        max_height,
    )?;
    with_cache(|c| c.insert(key, jpeg.clone()));
    Ok(jpeg)
}

/// Prefetch neighbor times for a video source (no-op for images beyond the primary frame).
pub fn prefetch_preview_neighbors(
    project_root: &Path,
    relative_source: &str,
    absolute_source: &Path,
    time_seconds: f64,
    max_height: u32,
    offsets: &[f64],
) {
    let Some(kind) = MediaKind::from_path(absolute_source) else {
        return;
    };
    if matches!(kind, MediaKind::Audio) {
        return;
    }
    if matches!(kind, MediaKind::Image) {
        let _ = frame_jpeg_cached_hot(project_root, relative_source, absolute_source, 0.0, max_height);
        return;
    }

    for &offset in offsets {
        let t = (time_seconds + offset).max(0.0);
        let key = PreviewCacheKey::for_source(project_root, relative_source, t, max_height, kind);
        let hit = with_cache(|c| c.get(&key).is_some());
        if hit {
            continue;
        }
        let _ = frame_jpeg_cached_hot(project_root, relative_source, absolute_source, t, max_height);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn image_cache_key_ignores_time() {
        let root = PathBuf::from("/proj");
        let a = PreviewCacheKey::for_source(&root, "Raw Footage/a.jpg", 0.0, 180, MediaKind::Image);
        let b = PreviewCacheKey::for_source(&root, "Raw Footage/a.jpg", 5.0, 180, MediaKind::Image);
        assert_eq!(a, b);
    }

    #[test]
    fn video_cache_key_buckets_time() {
        let root = PathBuf::from("/proj");
        let a = PreviewCacheKey::for_source(&root, "Raw Footage/a.mp4", 1.02, 180, MediaKind::Video);
        let b = PreviewCacheKey::for_source(&root, "Raw Footage/a.mp4", 1.04, 180, MediaKind::Video);
        assert_eq!(a.bucket_ms, b.bucket_ms);
        let c = PreviewCacheKey::for_source(&root, "Raw Footage/a.mp4", 1.20, 180, MediaKind::Video);
        assert_ne!(a.bucket_ms, c.bucket_ms);
    }

    #[test]
    fn lru_evicts_oldest() {
        let mut cache = LruInner::new(2);
        let k1 = PreviewCacheKey {
            relative_path: "a".into(),
            bucket_ms: 0,
            max_height: 10,
            is_image: true,
        };
        let k2 = PreviewCacheKey {
            relative_path: "b".into(),
            bucket_ms: 0,
            max_height: 10,
            is_image: true,
        };
        let k3 = PreviewCacheKey {
            relative_path: "c".into(),
            bucket_ms: 0,
            max_height: 10,
            is_image: true,
        };
        cache.insert(k1.clone(), vec![1]);
        cache.insert(k2.clone(), vec![2]);
        cache.insert(k3.clone(), vec![3]);
        assert!(cache.get(&k1).is_none());
        assert!(cache.get(&k2).is_some());
        assert!(cache.get(&k3).is_some());
    }
}
