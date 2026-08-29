export const DEFAULT_PIXELS_PER_SECOND = 80;
/** @deprecated Prefer DEFAULT_PIXELS_PER_SECOND or an explicit zoom scale. */
export const PIXELS_PER_SECOND = DEFAULT_PIXELS_PER_SECOND;

export const MIN_PIXELS_PER_SECOND = 16;
export const MAX_PIXELS_PER_SECOND = 480;

export const TRACK_LABEL_WIDTH = 110;
export const TRACK_GAP = 12; // matches Tailwind gap-3
export const TRACK_CONTENT_OFFSET = TRACK_LABEL_WIDTH + TRACK_GAP;

/** Keep playhead this far from the scroller's right edge while auto-following. */
export const PLAYHEAD_FOLLOW_MARGIN_PX = 100;

export const DEFAULT_TRACK_HEIGHT = 64;
/** Vertical inset between clip and track edge. 0 = clips fill the lane height. */
export const CLIP_INSET = 0;
export const MIN_TRACK_HEIGHT = 32;
export const MAX_TRACK_HEIGHT = 240;

/** One filmstrip thumbnail every N seconds of clip duration. */
export const FILMSTRIP_INTERVAL_SECONDS = 1;

const NICE_TIME_INTERVALS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

export function clampPixelsPerSecond(pps: number): number {
  return Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, pps));
}

export function clampTrackHeight(height: number): number {
  return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, height));
}

export function clipHeightForLane(laneHeight: number): number {
  return Math.max(16, laneHeight - 2 * CLIP_INSET);
}

/** True when `clip` starts exactly where `previous` ends (packed edge-to-edge). */
export function clipsAbut(
  previous: { start: number; duration: number } | null | undefined,
  clip: { start: number },
  epsilon = 1e-3,
): boolean {
  if (!previous) return false;
  return Math.abs(previous.start + previous.duration - clip.start) <= epsilon;
}

export function frameMaxHeightForLane(laneHeight: number): number {
  return Math.max(16, Math.round(clipHeightForLane(laneHeight)));
}

export function filmstripIntervalWidthPx(pps: number = DEFAULT_PIXELS_PER_SECOND): number {
  return FILMSTRIP_INTERVAL_SECONDS * pps;
}

/** Source times at the left edge of each filmstrip slot (every FILMSTRIP_INTERVAL_SECONDS). */
export function filmstripSampleTimes(sourceOffset: number, duration: number): number[] {
  if (duration <= 0) return [Math.max(0, sourceOffset)];
  const times: number[] = [];
  const last = sourceOffset + duration;
  for (let t = sourceOffset; t < last - 1e-6; t += FILMSTRIP_INTERVAL_SECONDS) {
    times.push(Math.max(0, t));
  }
  if (times.length === 0) times.push(Math.max(0, sourceOffset));
  return times;
}

export type FilmstripSlot = {
  /** Index into the 1s sample grid (0 = clip start). */
  sampleIndex: number;
  /** Source media time for this thumbnail. */
  sourceTime: number;
  /** Left offset within the clip, in pixels. */
  leftPx: number;
};

/**
 * Place filmstrip thumbs on a 1s grid, skipping samples whose slot would sit
 * under the previous thumbnail's displayed width (full-height, natural aspect).
 */
export function filmstripVisibleSlots(args: {
  sourceOffset: number;
  duration: number;
  pixelsPerSecond: number;
  /** Estimated on-screen thumb width (typically lane/clip height for contain). */
  thumbWidthPx: number;
}): FilmstripSlot[] {
  const { sourceOffset, duration, pixelsPerSecond, thumbWidthPx } = args;
  const slotW = filmstripIntervalWidthPx(pixelsPerSecond);
  const times = filmstripSampleTimes(sourceOffset, duration);
  if (times.length === 0) return [];

  const advance = Math.max(1, thumbWidthPx);
  const slots: FilmstripSlot[] = [];
  let occupiedUntil = 0;

  for (let i = 0; i < times.length; i++) {
    const leftPx = i * slotW;
    if (leftPx < occupiedUntil - 1e-6) continue;
    slots.push({
      sampleIndex: i,
      sourceTime: times[i]!,
      leftPx,
    });
    occupiedUntil = leftPx + advance;
  }

  return slots;
}

export function playheadLeftPx(
  playheadSeconds: number,
  pps: number = DEFAULT_PIXELS_PER_SECOND,
): number {
  return TRACK_CONTENT_OFFSET + playheadSeconds * pps;
}

/** Timeline canvas width: label offset + content + trailing gutter. */
export function timelineCanvasWidthPx(
  durationSeconds: number,
  pps: number = DEFAULT_PIXELS_PER_SECOND,
): number {
  return TRACK_CONTENT_OFFSET + durationSeconds * pps + 48;
}

export function timelineContentWidthPx(
  durationSeconds: number,
  pps: number = DEFAULT_PIXELS_PER_SECOND,
): number {
  return durationSeconds * pps;
}

export function formatRulerTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export type RulerTick = {
  time: number;
  x: number;
  major: boolean;
  label?: string;
};

function niceTimeInterval(targetSeconds: number): number {
  for (const n of NICE_TIME_INTERVALS) {
    if (n >= targetSeconds - 1e-9) return n;
  }
  return NICE_TIME_INTERVALS[NICE_TIME_INTERVALS.length - 1]!;
}

/** Choose major/minor tick spacing so labels stay readable at the current zoom. */
export function rulerTickSpacing(pps: number): { major: number; minor: number } {
  const major = niceTimeInterval(100 / Math.max(pps, 1));
  let minor = major / 5;
  if (minor * pps < 6) minor = major / 2;
  if (minor * pps < 6) minor = major;
  return { major, minor };
}

/**
 * Build ruler ticks for the current pixels-per-second scale.
 */
export function buildRulerTicks(
  durationSeconds: number,
  pps: number = DEFAULT_PIXELS_PER_SECOND,
): RulerTick[] {
  if (durationSeconds <= 0) return [];
  const { major: majorEvery, minor: minorEvery } = rulerTickSpacing(pps);
  const ticks: RulerTick[] = [];
  const steps = Math.ceil(durationSeconds / minorEvery + 1e-9);

  for (let i = 0; i <= steps; i++) {
    const t = Number((i * minorEvery).toFixed(6));
    if (t > durationSeconds + 1e-6) break;
    const nearestMajor = Math.round(t / majorEvery) * majorEvery;
    const isMajor = Math.abs(t - nearestMajor) < minorEvery * 0.25;
    ticks.push({
      time: t,
      x: t * pps,
      major: isMajor,
      label: isMajor ? formatRulerTime(t) : undefined,
    });
  }
  return ticks;
}

export function timeFromTimelineX(
  clientX: number,
  timelineLeft: number,
  pps: number = DEFAULT_PIXELS_PER_SECOND,
): number {
  return Math.max(0, (clientX - timelineLeft - TRACK_CONTENT_OFFSET) / pps);
}

export function timeFromTrackContentX(
  clientX: number,
  trackContentLeft: number,
  pps: number = DEFAULT_PIXELS_PER_SECOND,
): number {
  return Math.max(0, (clientX - trackContentLeft) / pps);
}

/** True if [start, start+duration) overlaps any clip on the same track. */
export function rangeOverlapsClips(
  clips: { start: number; duration: number }[],
  start: number,
  duration: number,
): boolean {
  const end = start + duration;
  return clips.some((c) => start < c.start + c.duration && end > c.start);
}

export function trackOccupiedEnd(clips: { start: number; duration: number }[]): number {
  return clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
}

/**
 * Prefer the cursor time; if that would overlap, snap to the end of the last clip
 * on the track (append).
 */
export function snapClipStart(
  clips: { start: number; duration: number }[],
  desiredStart: number,
  duration: number,
): number {
  const start = Math.max(0, desiredStart);
  if (!rangeOverlapsClips(clips, start, duration)) return start;
  return trackOccupiedEnd(clips);
}

/**
 * Snap a moved clip's start: keep the desired time when free, otherwise nudge to the
 * nearer free edge of the overlapping neighbor (or append if needed).
 */
export function snapMovedClipStart(
  others: { start: number; duration: number }[],
  desiredStart: number,
  duration: number,
): number {
  const start = Math.max(0, desiredStart);
  if (!rangeOverlapsClips(others, start, duration)) return start;

  const sorted = [...others].sort((a, b) => a.start - b.start);
  const end = start + duration;

  for (const other of sorted) {
    const otherEnd = other.start + other.duration;
    if (!(start < otherEnd && end > other.start)) continue;

    const before = other.start - duration;
    const after = otherEnd;
    const beforeOk = before >= 0 && !rangeOverlapsClips(others, before, duration);
    const afterOk = !rangeOverlapsClips(others, after, duration);

    if (beforeOk && afterOk) {
      return Math.abs(desiredStart - before) <= Math.abs(desiredStart - after) ? before : after;
    }
    if (beforeOk) return before;
    if (afterOk) return after;
  }

  return trackOccupiedEnd(others);
}

export type ClipGroupPlacement = {
  clipId: string;
  trackId: string;
  start: number;
  duration: number;
};

type GroupMoveClip = {
  id: string;
  track_id: string;
  start: number;
  duration: number;
  media_kind: "video" | "image" | "audio";
};

type GroupMoveTrack = {
  id: string;
  kind: "video" | "audio";
};

/**
 * Rigid-body move for one or more clips. Preserves relative start times and relative
 * track indices (dropping the grabbed clip onto another track shifts the whole group).
 */
export function planClipGroupMove(args: {
  moving: GroupMoveClip[];
  primaryId: string;
  desiredPrimaryStart: number;
  primaryDestTrackId: string;
  tracks: GroupMoveTrack[];
  allClips: GroupMoveClip[];
  mediaCompatible: (
    mediaKind: GroupMoveClip["media_kind"],
    trackKind: GroupMoveTrack["kind"],
  ) => boolean;
}): ClipGroupPlacement[] | null {
  const {
    moving,
    primaryId,
    desiredPrimaryStart,
    primaryDestTrackId,
    tracks,
    allClips,
    mediaCompatible,
  } = args;
  if (moving.length === 0) return null;

  const primary = moving.find((c) => c.id === primaryId) ?? moving[0]!;
  const primaryTrackIdx = tracks.findIndex((t) => t.id === primary.track_id);
  const destTrackIdx = tracks.findIndex((t) => t.id === primaryDestTrackId);
  if (primaryTrackIdx < 0 || destTrackIdx < 0) return null;

  const trackDelta = destTrackIdx - primaryTrackIdx;
  const movingIds = new Set(moving.map((c) => c.id));
  const destTrackByClipId = new Map<string, GroupMoveTrack>();

  for (const clip of moving) {
    const srcIdx = tracks.findIndex((t) => t.id === clip.track_id);
    if (srcIdx < 0) return null;
    const dest = tracks[srcIdx + trackDelta];
    if (!dest || !mediaCompatible(clip.media_kind, dest.kind)) return null;
    destTrackByClipId.set(clip.id, dest);
  }

  const minStart = Math.min(...moving.map((c) => c.start));

  const placementsAt = (delta: number): ClipGroupPlacement[] =>
    moving.map((clip) => ({
      clipId: clip.id,
      trackId: destTrackByClipId.get(clip.id)!.id,
      start: clip.start + delta,
      duration: clip.duration,
    }));

  type Conflict =
    | { kind: "none" }
    | { kind: "push"; nextDelta: number }
    | { kind: "impossible" };

  const analyze = (delta: number): Conflict => {
    const placements = placementsAt(delta);
    let pushTo: number | null = null;

    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i]!;
        const b = placements[j]!;
        if (a.trackId !== b.trackId) continue;
        if (a.start < b.start + b.duration && a.start + a.duration > b.start) {
          return { kind: "impossible" };
        }
      }
    }

    for (const placement of placements) {
      const orig = moving.find((c) => c.id === placement.clipId)!;
      if (placement.start < -1e-9) {
        pushTo = Math.max(pushTo ?? delta, -orig.start);
        continue;
      }
      const others = allClips.filter(
        (c) => c.track_id === placement.trackId && !movingIds.has(c.id),
      );
      for (const other of others) {
        const otherEnd = other.start + other.duration;
        if (
          placement.start < otherEnd &&
          placement.start + placement.duration > other.start
        ) {
          pushTo = Math.max(pushTo ?? delta, otherEnd - orig.start);
        }
      }
    }

    if (pushTo != null && pushTo > delta + 1e-9) {
      return { kind: "push", nextDelta: pushTo };
    }
    return { kind: "none" };
  };

  let delta = Math.max(desiredPrimaryStart - primary.start, -minStart);

  if (analyze(delta).kind === "none") return placementsAt(delta);

  const primaryDest = destTrackByClipId.get(primary.id)!;
  const othersPrimary = allClips
    .filter((c) => c.track_id === primaryDest.id && !movingIds.has(c.id))
    .map((c) => ({ start: c.start, duration: c.duration }));
  const snappedPrimary = snapMovedClipStart(
    othersPrimary,
    primary.start + delta,
    primary.duration,
  );
  delta = Math.max(snappedPrimary - primary.start, -minStart);
  if (analyze(delta).kind === "none") return placementsAt(delta);

  for (let i = 0; i < 32; i++) {
    const result = analyze(delta);
    if (result.kind === "none") return placementsAt(delta);
    if (result.kind === "impossible") break;
    if (result.nextDelta <= delta + 1e-9) break;
    delta = result.nextDelta;
  }

  if (analyze(delta).kind === "none") return placementsAt(delta);

  const leftmost = moving.reduce((a, b) => (a.start <= b.start ? a : b));
  const leftDest = destTrackByClipId.get(leftmost.id)!;
  const othersLeft = allClips
    .filter((c) => c.track_id === leftDest.id && !movingIds.has(c.id))
    .map((c) => ({ start: c.start, duration: c.duration }));
  delta = trackOccupiedEnd(othersLeft) - leftmost.start;
  return analyze(delta).kind === "none" ? placementsAt(delta) : null;
}

/**
 * Largest duration a clip may take without overlapping the next clip on its track.
 * `null` means unbounded (nothing to the right).
 */
export function maxClipDurationOnTrack(
  clip: { id: string; track_id: string; start: number },
  clips: { id: string; track_id: string; start: number }[],
): number | null {
  let nextStart = Number.POSITIVE_INFINITY;
  for (const other of clips) {
    if (other.track_id !== clip.track_id || other.id === clip.id) continue;
    if (other.start >= clip.start && other.start < nextStart) {
      nextStart = other.start;
    }
  }
  if (!Number.isFinite(nextStart)) return null;
  // Match the duration input's minimum step.
  return Math.max(0.1, nextStart - clip.start);
}
