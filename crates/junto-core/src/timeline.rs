use std::collections::{HashMap, HashSet};

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
        let track = self
            .track(track_id)
            .ok_or_else(|| JuntoError::TrackNotFound(track_id.to_string()))?;

        if !media_kind_matches_track(media_kind, track.kind) {
            return Err(JuntoError::Timeline(format!(
                "media kind {:?} is not compatible with {:?} track",
                media_kind, track.kind
            )));
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
        self.move_clip_to_track(clip_id, new_start, None)
    }

    /// Move a clip to a new start time, optionally onto another track.
    pub fn move_clip_to_track(
        &mut self,
        clip_id: Uuid,
        new_start: f64,
        new_track_id: Option<Uuid>,
    ) -> Result<()> {
        let clip = self
            .clips
            .iter()
            .find(|c| c.id == clip_id)
            .ok_or_else(|| JuntoError::ClipNotFound(clip_id.to_string()))?
            .clone();

        if new_start < 0.0 {
            return Err(JuntoError::Timeline("start time cannot be negative".into()));
        }

        let dest_track_id = new_track_id.unwrap_or(clip.track_id);
        let dest_track = self
            .track(dest_track_id)
            .ok_or_else(|| JuntoError::TrackNotFound(dest_track_id.to_string()))?;

        if !media_kind_matches_track(clip.media_kind, dest_track.kind) {
            return Err(JuntoError::Timeline(format!(
                "media kind {:?} is not compatible with {:?} track",
                clip.media_kind, dest_track.kind
            )));
        }

        let candidate = Clip {
            start: new_start,
            track_id: dest_track_id,
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
        clip_mut.track_id = dest_track_id;
        Ok(())
    }

    /// Atomically move multiple clips to new start times / tracks.
    ///
    /// Overlap checks ignore all clips in the move set, and also ensure the
    /// proposed placements do not overlap each other.
    pub fn move_clips(
        &mut self,
        moves: &[(Uuid, f64, Uuid)], // clip_id, new_start, new_track_id
    ) -> Result<()> {
        if moves.is_empty() {
            return Ok(());
        }

        let moving_ids: HashSet<Uuid> = moves.iter().map(|(id, _, _)| *id).collect();
        if moving_ids.len() != moves.len() {
            return Err(JuntoError::Timeline(
                "duplicate clip id in move_clips".into(),
            ));
        }

        let mut planned: Vec<(Uuid, f64, Uuid, f64)> = Vec::with_capacity(moves.len());
        // clip_id, start, track_id, duration

        for &(clip_id, new_start, new_track_id) in moves {
            if new_start < 0.0 {
                return Err(JuntoError::Timeline(
                    "start time cannot be negative".into(),
                ));
            }

            let clip = self
                .clips
                .iter()
                .find(|c| c.id == clip_id)
                .ok_or_else(|| JuntoError::ClipNotFound(clip_id.to_string()))?
                .clone();

            let dest_track = self.track(new_track_id).ok_or_else(|| {
                JuntoError::TrackNotFound(new_track_id.to_string())
            })?;

            if !media_kind_matches_track(clip.media_kind, dest_track.kind) {
                return Err(JuntoError::Timeline(format!(
                    "media kind {:?} is not compatible with {:?} track",
                    clip.media_kind, dest_track.kind
                )));
            }

            planned.push((clip_id, new_start, new_track_id, clip.duration));
        }

        // Mutual overlaps among planned placements on the same track.
        for i in 0..planned.len() {
            for j in (i + 1)..planned.len() {
                let (_, a_start, a_track, a_dur) = planned[i];
                let (_, b_start, b_track, b_dur) = planned[j];
                if a_track != b_track {
                    continue;
                }
                if a_start < b_start + b_dur && a_start + a_dur > b_start {
                    return Err(JuntoError::Timeline(
                        "move would overlap another clip in the selection".into(),
                    ));
                }
            }
        }

        // Overlaps against clips not being moved.
        for &(_clip_id, new_start, new_track_id, duration) in &planned {
            let end = new_start + duration;
            let overlaps = self.clips.iter().any(|other| {
                if moving_ids.contains(&other.id) {
                    return false;
                }
                if other.track_id != new_track_id {
                    return false;
                }
                new_start < other.start + other.duration && end > other.start
            });
            if overlaps {
                return Err(JuntoError::Timeline(
                    "move would overlap another clip on this track".into(),
                ));
            }
        }

        for &(clip_id, new_start, new_track_id, _) in &planned {
            let clip_mut = self
                .clips
                .iter_mut()
                .find(|c| c.id == clip_id)
                .expect("clip exists");
            clip_mut.start = new_start;
            clip_mut.track_id = new_track_id;
        }

        Ok(())
    }

    /// Trim a clip by updating its source offset and visible duration.
    pub fn trim_clip(&mut self, clip_id: Uuid, source_offset: f64, duration: f64) -> Result<()> {
        if source_offset < 0.0 {
            return Err(JuntoError::Timeline(
                "source_offset cannot be negative".into(),
            ));
        }
        if duration <= 0.0 {
            return Err(JuntoError::Timeline("duration must be greater than 0".into()));
        }

        let clip = self
            .clips
            .iter()
            .find(|c| c.id == clip_id)
            .ok_or_else(|| JuntoError::ClipNotFound(clip_id.to_string()))?
            .clone();

        let candidate = Clip {
            source_offset,
            duration,
            ..clip
        };

        if overlaps_on_track(self, &candidate, Some(clip_id)) {
            return Err(JuntoError::Timeline(
                "trim would overlap another clip on this track".into(),
            ));
        }

        let clip_mut = self
            .clips
            .iter_mut()
            .find(|c| c.id == clip_id)
            .expect("clip exists");
        clip_mut.source_offset = source_offset;
        clip_mut.duration = duration;
        Ok(())
    }

    /// Change a clip's visible duration while keeping its source offset.
    pub fn set_clip_duration(&mut self, clip_id: Uuid, duration: f64) -> Result<()> {
        if duration <= 0.0 {
            return Err(JuntoError::Timeline("duration must be greater than 0".into()));
        }

        let clip = self
            .clips
            .iter()
            .find(|c| c.id == clip_id)
            .ok_or_else(|| JuntoError::ClipNotFound(clip_id.to_string()))?
            .clone();

        let candidate = Clip {
            duration,
            ..clip
        };

        if overlaps_on_track(self, &candidate, Some(clip_id)) {
            return Err(JuntoError::Timeline(
                "duration change would overlap another clip on this track".into(),
            ));
        }

        let clip_mut = self
            .clips
            .iter_mut()
            .find(|c| c.id == clip_id)
            .expect("clip exists");
        clip_mut.duration = duration;
        Ok(())
    }

    /// Remove a clip and ripple later clips on the same track left by its duration.
    pub fn remove_clip(&mut self, clip_id: Uuid) -> Result<()> {
        self.remove_clips(&[clip_id])
    }

    /// Remove one or more clips and ripple remaining clips on each affected track.
    ///
    /// For every surviving clip, its start shifts left by the total duration of
    /// deleted clips that began earlier on the same track. All removals are
    /// applied atomically so multi-delete order does not matter.
    pub fn remove_clips(&mut self, clip_ids: &[Uuid]) -> Result<()> {
        if clip_ids.is_empty() {
            return Ok(());
        }

        let mut unique: HashSet<Uuid> = HashSet::new();
        for id in clip_ids {
            if !unique.insert(*id) {
                continue;
            }
            if !self.clips.iter().any(|c| c.id == *id) {
                return Err(JuntoError::ClipNotFound(id.to_string()));
            }
        }

        // Per track: deleted (start, duration) pairs for ripple math.
        let mut deleted_by_track: HashMap<Uuid, Vec<(f64, f64)>> = HashMap::new();
        for clip in &self.clips {
            if !unique.contains(&clip.id) {
                continue;
            }
            deleted_by_track
                .entry(clip.track_id)
                .or_default()
                .push((clip.start, clip.duration));
        }

        // New starts for survivors before we mutate the vec.
        let mut new_starts: HashMap<Uuid, f64> = HashMap::new();
        for clip in &self.clips {
            if unique.contains(&clip.id) {
                continue;
            }
            let Some(deleted) = deleted_by_track.get(&clip.track_id) else {
                continue;
            };
            let shift: f64 = deleted
                .iter()
                .filter(|(start, _)| *start < clip.start - 1e-9)
                .map(|(_, duration)| *duration)
                .sum();
            if shift > 1e-12 {
                new_starts.insert(clip.id, (clip.start - shift).max(0.0));
            }
        }

        self.clips.retain(|c| !unique.contains(&c.id));
        for clip in &mut self.clips {
            if let Some(start) = new_starts.get(&clip.id) {
                clip.start = *start;
            }
        }

        Ok(())
    }
}

fn media_kind_matches_track(media_kind: MediaKind, track_kind: TrackKind) -> bool {
    match (media_kind, track_kind) {
        (MediaKind::Video | MediaKind::Image, TrackKind::Video) => true,
        (MediaKind::Audio, TrackKind::Audio) => true,
        _ => false,
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

    fn video_track(timeline: &Timeline) -> Uuid {
        timeline
            .tracks
            .iter()
            .find(|t| t.kind == TrackKind::Video)
            .expect("video track")
            .id
    }

    fn audio_track(timeline: &Timeline) -> Uuid {
        timeline
            .tracks
            .iter()
            .find(|t| t.kind == TrackKind::Audio)
            .expect("audio track")
            .id
    }

    #[test]
    fn add_clip_rejects_incompatible_track_kind() {
        let mut timeline = Timeline::new();
        let video = video_track(&timeline);
        let audio = audio_track(&timeline);

        assert!(timeline
            .add_clip(
                video,
                "Raw Footage/song.mp3".into(),
                MediaKind::Audio,
                0.0,
                2.0,
            )
            .is_err());
        assert!(timeline
            .add_clip(
                audio,
                "Raw Footage/clip.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .is_err());
    }

    #[test]
    fn rejects_overlapping_clips() {
        let mut timeline = Timeline::new();
        let track = video_track(&timeline);
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

    #[test]
    fn trim_clip_updates_offset_and_duration() {
        let mut timeline = Timeline::new();
        let track = video_track(&timeline);
        let id = timeline
            .add_clip(
                track,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                5.0,
            )
            .unwrap();
        timeline.trim_clip(id, 1.5, 2.0).unwrap();
        let clip = timeline.clips.iter().find(|c| c.id == id).unwrap();
        assert!((clip.source_offset - 1.5).abs() < f64::EPSILON);
        assert!((clip.duration - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn trim_clip_rejects_invalid_values_and_overlap() {
        let mut timeline = Timeline::new();
        let track = video_track(&timeline);
        let a = timeline
            .add_clip(
                track,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        timeline
            .add_clip(
                track,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                3.0,
                2.0,
            )
            .unwrap();

        assert!(timeline.trim_clip(a, -1.0, 1.0).is_err());
        assert!(timeline.trim_clip(a, 0.0, 0.0).is_err());
        // Extending into the next clip should fail.
        assert!(timeline.trim_clip(a, 0.0, 3.5).is_err());
    }

    #[test]
    fn set_clip_duration_keeps_source_offset() {
        let mut timeline = Timeline::new();
        let track = video_track(&timeline);
        let id = timeline
            .add_clip(
                track,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                5.0,
            )
            .unwrap();
        timeline.trim_clip(id, 1.0, 3.0).unwrap();
        timeline.set_clip_duration(id, 2.0).unwrap();
        let clip = timeline.clips.iter().find(|c| c.id == id).unwrap();
        assert!((clip.source_offset - 1.0).abs() < f64::EPSILON);
        assert!((clip.duration - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn set_clip_duration_rejects_overlap() {
        let mut timeline = Timeline::new();
        let track = video_track(&timeline);
        let a = timeline
            .add_clip(
                track,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        timeline
            .add_clip(
                track,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                3.0,
                1.0,
            )
            .unwrap();
        assert!(timeline.set_clip_duration(a, 3.5).is_err());
    }

    #[test]
    fn move_clip_to_track_relocates_compatible_clip() {
        let mut timeline = Timeline::new();
        let v1 = video_track(&timeline);
        let v2 = timeline.add_track(TrackKind::Video);
        let id = timeline
            .add_clip(
                v1,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        timeline.move_clip_to_track(id, 1.0, Some(v2)).unwrap();
        let clip = timeline.clips.iter().find(|c| c.id == id).unwrap();
        assert_eq!(clip.track_id, v2);
        assert!((clip.start - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn move_clip_to_track_rejects_kind_mismatch_and_overlap() {
        let mut timeline = Timeline::new();
        let video = video_track(&timeline);
        let audio = audio_track(&timeline);
        let id = timeline
            .add_clip(
                video,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        assert!(timeline.move_clip_to_track(id, 0.0, Some(audio)).is_err());

        let v2 = timeline.add_track(TrackKind::Video);
        timeline
            .add_clip(
                v2,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                0.0,
                3.0,
            )
            .unwrap();
        assert!(timeline.move_clip_to_track(id, 1.0, Some(v2)).is_err());
    }

    #[test]
    fn move_clip_without_track_keeps_track() {
        let mut timeline = Timeline::new();
        let track = video_track(&timeline);
        let id = timeline
            .add_clip(
                track,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        timeline.move_clip(id, 4.0).unwrap();
        let clip = timeline.clips.iter().find(|c| c.id == id).unwrap();
        assert_eq!(clip.track_id, track);
        assert!((clip.start - 4.0).abs() < f64::EPSILON);
    }

    #[test]
    fn move_clips_moves_group_atomically() {
        let mut timeline = Timeline::new();
        let video = video_track(&timeline);
        let a = timeline
            .add_clip(
                video,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                1.0,
            )
            .unwrap();
        let b = timeline
            .add_clip(
                video,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                1.0,
                1.0,
            )
            .unwrap();
        timeline
            .move_clips(&[(a, 5.0, video), (b, 6.0, video)])
            .unwrap();
        let clip_a = timeline.clips.iter().find(|c| c.id == a).unwrap();
        let clip_b = timeline.clips.iter().find(|c| c.id == b).unwrap();
        assert!((clip_a.start - 5.0).abs() < f64::EPSILON);
        assert!((clip_b.start - 6.0).abs() < f64::EPSILON);
    }

    #[test]
    fn move_clips_rejects_overlap_with_outsider() {
        let mut timeline = Timeline::new();
        let video = video_track(&timeline);
        let a = timeline
            .add_clip(
                video,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                1.0,
            )
            .unwrap();
        let _b = timeline
            .add_clip(
                video,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                5.0,
                2.0,
            )
            .unwrap();
        assert!(timeline.move_clips(&[(a, 5.5, video)]).is_err());
    }

    #[test]
    fn remove_clip_ripples_later_clips_on_same_track() {
        let mut timeline = Timeline::new();
        let video = video_track(&timeline);
        let a = timeline
            .add_clip(
                video,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        let b = timeline
            .add_clip(
                video,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                2.0,
                3.0,
            )
            .unwrap();
        let c = timeline
            .add_clip(
                video,
                "Raw Footage/c.mp4".into(),
                MediaKind::Video,
                5.0,
                1.0,
            )
            .unwrap();

        timeline.remove_clip(a).unwrap();
        let clip_b = timeline.clips.iter().find(|clip| clip.id == b).unwrap();
        let clip_c = timeline.clips.iter().find(|clip| clip.id == c).unwrap();
        assert!((clip_b.start - 0.0).abs() < f64::EPSILON);
        assert!((clip_c.start - 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn remove_clips_ripples_batch_independently_of_order() {
        let mut timeline = Timeline::new();
        let video = video_track(&timeline);
        let a = timeline
            .add_clip(
                video,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        let b = timeline
            .add_clip(
                video,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                2.0,
                3.0,
            )
            .unwrap();
        let c = timeline
            .add_clip(
                video,
                "Raw Footage/c.mp4".into(),
                MediaKind::Video,
                5.0,
                2.0,
            )
            .unwrap();
        let d = timeline
            .add_clip(
                video,
                "Raw Footage/d.mp4".into(),
                MediaKind::Video,
                7.0,
                1.0,
            )
            .unwrap();

        // Delete A and C; B and D should shift by 2 and 4 respectively.
        timeline.remove_clips(&[c, a]).unwrap();
        let clip_b = timeline.clips.iter().find(|clip| clip.id == b).unwrap();
        let clip_d = timeline.clips.iter().find(|clip| clip.id == d).unwrap();
        assert!((clip_b.start - 0.0).abs() < f64::EPSILON);
        assert!((clip_d.start - 3.0).abs() < f64::EPSILON);
        assert_eq!(timeline.clips.len(), 2);
    }

    #[test]
    fn remove_clip_does_not_ripple_other_tracks() {
        let mut timeline = Timeline::new();
        let v1 = video_track(&timeline);
        let v2 = timeline.add_track(TrackKind::Video);
        let a = timeline
            .add_clip(
                v1,
                "Raw Footage/a.mp4".into(),
                MediaKind::Video,
                0.0,
                2.0,
            )
            .unwrap();
        let b = timeline
            .add_clip(
                v2,
                "Raw Footage/b.mp4".into(),
                MediaKind::Video,
                2.0,
                3.0,
            )
            .unwrap();
        timeline.remove_clip(a).unwrap();
        let clip_b = timeline.clips.iter().find(|clip| clip.id == b).unwrap();
        assert!((clip_b.start - 2.0).abs() < f64::EPSILON);
    }
}
