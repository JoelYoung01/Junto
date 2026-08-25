export const PIXELS_PER_SECOND = 80;

export const DEFAULT_TRACK_HEIGHT = 64;
export const CLIP_INSET = 8;
export const MIN_TRACK_HEIGHT = 32;
export const MAX_TRACK_HEIGHT = 240;

export function clampTrackHeight(height: number): number {
  return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, height));
}

export function clipHeightForLane(laneHeight: number): number {
  return Math.max(16, laneHeight - 2 * CLIP_INSET);
}

export function frameMaxHeightForLane(laneHeight: number): number {
  return Math.max(16, Math.round(clipHeightForLane(laneHeight)));
}

export function filmstripSampleCount(
  durationSeconds: number,
  clipHeight: number,
  maxSamples = 6,
): number {
  const clipWidthPx = durationSeconds * PIXELS_PER_SECOND;
  const thumbWidth = Math.max(24, clipHeight);
  return Math.min(maxSamples, Math.max(1, Math.ceil(clipWidthPx / thumbWidth)));
}
