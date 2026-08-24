use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{JuntoError, Result};
use crate::media::MediaKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: Uuid,
    pub name: String,
    pub kind: TrackKind,
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: Uuid,
    pub track_id: Uuid,
    /// Path relative to project root (e.g. `Raw Footage/clip.mp4`).
    pub source_path: String,
    pub media_kind: MediaKind,
    /// Start position on the timeline in seconds.
    pub start: f64,
    /// Visible duration on the timeline in seconds.
    pub duration: f64,
    /// Trim offset into the source file in seconds.
    pub source_offset: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timeline {
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
    /// Playhead position in seconds.
    pub playhead: f64,
}

impl Default for Timeline {
    fn default() -> Self {
        Self::new()
    }
}

impl Timeline {
    pub fn new() -> Self {
        Self {
            tracks: vec![
                Track {
                    id: Uuid::new_v4(),
                    name: "Video 1".into(),
                    kind: TrackKind::Video,
                    index: 0,
                },
                Track {
                    id: Uuid::new_v4(),
                    name: "Audio 1".into(),
                    kind: TrackKind::Audio,
                    index: 0,
                },
            ],
            clips: Vec::new(),
            playhead: 0.0,
        }
    }

    pub fn duration(&self) -> f64 {
        self.clips
            .iter()
            .map(|c| c.start + c.duration)
            .fold(0.0, f64::max)
    }

    pub fn track(&self, id: Uuid) -> Option<&Track> {
        self.tracks.iter().find(|t| t.id == id)
    }

    pub fn clips_on_track(&self, track_id: Uuid) -> Vec<&Clip> {
        let mut clips: Vec<_> = self.clips.iter().filter(|c| c.track_id == track_id).collect();
        clips.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap());
        clips
    }

    pub fn add_track(&mut self, kind: TrackKind) -> Uuid {
        let count = self
            .tracks
            .iter()
            .filter(|t| t.kind == kind)
            .count() as u32;
        let id = Uuid::new_v4();
        let name = match kind {
            TrackKind::Video => format!("Video {}", count + 1),
            TrackKind::Audio => format!("Audio {}", count + 1),
        };
        self.tracks.push(Track {
            id,
            name,
            kind,
            index: count,
        });
        id
    }

    pub fn add_clip(
        &mut self,
        track_id: Uuid,
        source_path: String,
        media_kind: MediaKind,
        start: f64,
        duration: f64,
    ) -> Result<Uuid> {
        if self.track(track_id).is_none() {
            return Err(JuntoError::TrackNotFound(track_id.to_string()));
        }

        let clip = Clip {
            id: Uuid::new_v4(),
            track_id,
            source_path,
            media_kind,
            start,
            duration,
            source_offset: 0.0,
        };

        if overlaps_on_track(self, &clip, None) {
            return Err(JuntoError::Timeline(
                "clip would overlap another clip on this track".into(),
            ));
        }

        let id = clip.id;
        self.clips.push(clip);
        Ok(id)
    }

    pub fn move_clip(&mut self, clip_id: Uuid, new_start: f64) -> Result<()> {
        let clip = self
            .clips
            .iter()
            .find(|c| c.id == clip_id)
            .ok_or_else(|| JuntoError::ClipNotFound(clip_id.to_string()))?
            .clone();

        if new_start < 0.0 {
            return Err(JuntoError::Timeline("start time cannot be negative".into()));
        }

        let candidate = Clip {
            start: new_start,
            ..clip
        };

        if overlaps_on_track(self, &candidate, Some(clip_id)) {
            return Err(JuntoError::Timeline(
                "move would overlap another clip on this track".into(),
            ));
        }

        let clip_mut = self
            .clips
            .iter_mut()
            .find(|c| c.id == clip_id)
            .expect("clip exists");
        clip_mut.start = new_start;
        Ok(())
    }

    pub fn remove_clip(&mut self, clip_id: Uuid) -> Result<()> {
        let len_before = self.clips.len();
        self.clips.retain(|c| c.id != clip_id);
        if self.clips.len() == len_before {
            return Err(JuntoError::ClipNotFound(clip_id.to_string()));
        }
        Ok(())
    }
}

fn overlaps_on_track(timeline: &Timeline, clip: &Clip, ignore_id: Option<Uuid>) -> bool {
    let end = clip.start + clip.duration;
    timeline
        .clips
        .iter()
        .filter(|c| c.track_id == clip.track_id)
        .filter(|c| ignore_id.map(|id| c.id != id).unwrap_or(true))
        .any(|other| clip.start < other.start + other.duration && end > other.start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_overlapping_clips() {
        let mut timeline = Timeline::new();
        let track = timeline.tracks[0].id;
        timeline
            .add_clip(
                track,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                5.0,
            )
            .unwrap();
        assert!(timeline
            .add_clip(
                track,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                3.0,
                2.0,
            )
            .is_err());
    }
}
