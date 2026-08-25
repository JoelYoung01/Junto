import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { api, Clip } from "@/api";
import {
  CLIP_INSET,
  DEFAULT_TRACK_HEIGHT,
  PIXELS_PER_SECOND,
  clipHeightForLane,
  filmstripSampleCount,
  frameMaxHeightForLane,
} from "@/lib/timelineLayout";
const FILMSTRIP_SAMPLES = 6;

interface TimelineClipProps {
  clip: Clip;
  laneHeight?: number;
  selected?: boolean;
  onSelect?: () => void;
  onDragStart: () => void;
  onDragEnd: (event: React.MouseEvent<HTMLDivElement>) => void;
  onRemove: () => void;
}

function sampleTimes(sourceOffset: number, duration: number, count: number): number[] {
  if (duration <= 0 || count <= 1) return [Math.max(0, sourceOffset)];
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = sourceOffset + (duration * i) / (count - 1);
    times.push(i === count - 1 ? Math.max(sourceOffset, t - 0.001) : t);
  }
  return times;
}

export function TimelineClip({
  clip,
  laneHeight = DEFAULT_TRACK_HEIGHT,
  selected = false,
  onSelect,
  onDragStart,
  onDragEnd,
  onRemove,
}: TimelineClipProps) {
  const clipHeight = clipHeightForLane(laneHeight);
  const deferredLaneHeight = useDeferredValue(laneHeight);
  const frameMaxHeight = frameMaxHeightForLane(deferredLaneHeight);
  const [frames, setFrames] = useState<(string | null)[]>([]);

  const times = useMemo(() => {
    if (clip.media_kind === "audio") return [] as number[];
    const sampleCount =
      clip.media_kind === "image"
        ? 1
        : filmstripSampleCount(clip.duration, clipHeight, FILMSTRIP_SAMPLES);
    return sampleTimes(clip.source_offset, clip.duration, sampleCount);
  }, [clip.media_kind, clip.source_offset, clip.duration, clipHeight]);

  useEffect(() => {
    if (clip.media_kind === "audio") {
      setFrames([]);
      return;
    }
    const maxHeight = frameMaxHeight;
    let cancelled = false;
    void Promise.all(
      times.map((time) => api.getMediaFrame(clip.source_path, time, maxHeight).catch(() => null)),
    ).then((urls) => {
      if (!cancelled) setFrames(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [clip.source_path, clip.media_kind, times, frameMaxHeight]);

  const fallback =
    clip.media_kind === "audio"
      ? "bg-amber-700"
      : clip.media_kind === "image"
        ? "bg-emerald-800"
        : "bg-blue-800";

  const ring = selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "";

  return (
    <div
      className={`absolute flex cursor-pointer items-center overflow-hidden rounded-md text-xs text-white shadow-sm ${fallback} ${ring}`}
      style={{
        top: CLIP_INSET,
        height: clipHeight,
        left: clip.start * PIXELS_PER_SECOND,
        width: Math.max(clip.duration * PIXELS_PER_SECOND, 24),
      }}
      draggable
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {clip.media_kind !== "audio" && frames.some(Boolean) && (
        <div className="absolute inset-0 flex">
          {frames.map((url, index) =>
            url ? (
              <div key={`${clip.id}-frame-${index}`} className="h-full min-w-0 flex-1 overflow-hidden">
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              </div>
            ) : (
              <div key={`${clip.id}-frame-${index}`} className={`h-full flex-1 ${fallback}`} />
            ),
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-black/10" />
      <button
        type="button"
        className="relative z-10 ml-auto rounded p-1 hover:bg-black/30"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
