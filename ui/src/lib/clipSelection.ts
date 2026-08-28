import type { Clip, Track } from "@/api";

/** Track list index, or -1 if missing. */
function trackIndexOf(tracks: Track[], trackId: string): number {
  return tracks.findIndex((t) => t.id === trackId);
}

/**
 * Clips in a shift-click range from `anchorId` to `targetId`.
 *
 * - Same track: chronological by `start` between the two (inclusive).
 * - Different tracks: all tracks between them (inclusive) and the same
 *   chronological start window — spans both/all involved tracks.
 */
export function clipIdsInChronologicalRange(
  clips: Clip[],
  tracks: Track[],
  anchorId: string,
  targetId: string,
): string[] {
  const anchor = clips.find((c) => c.id === anchorId);
  const target = clips.find((c) => c.id === targetId);
  if (!target) return [];
  if (!anchor || anchor.id === target.id) return [target.id];

  const aIdx = trackIndexOf(tracks, anchor.track_id);
  const bIdx = trackIndexOf(tracks, target.track_id);
  if (aIdx < 0 || bIdx < 0) return [target.id];

  const trackLo = Math.min(aIdx, bIdx);
  const trackHi = Math.max(aIdx, bIdx);
  const timeLo = Math.min(anchor.start, target.start);
  const timeHi = Math.max(anchor.start, target.start);

  const trackIds = new Set(
    tracks.filter((_, i) => i >= trackLo && i <= trackHi).map((t) => t.id),
  );

  return clips
    .filter(
      (c) =>
        trackIds.has(c.track_id) &&
        c.start >= timeLo - 1e-9 &&
        c.start <= timeHi + 1e-9,
    )
    .map((c) => c.id);
}

export function toggleClipInSelection(selectedIds: string[], clipId: string): string[] {
  return selectedIds.includes(clipId)
    ? selectedIds.filter((id) => id !== clipId)
    : [...selectedIds, clipId];
}

/** All clip ids on a track, ordered by start time. */
export function clipIdsOnTrack(clips: Clip[], trackId: string): string[] {
  return clips
    .filter((c) => c.track_id === trackId)
    .sort((a, b) => a.start - b.start)
    .map((c) => c.id);
}
