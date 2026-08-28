import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { api, Clip } from "@/api";
import {
  CLIP_INSET,
  DEFAULT_PIXELS_PER_SECOND,
  DEFAULT_TRACK_HEIGHT,
  clipHeightForLane,
  filmstripIntervalWidthPx,
  filmstripSampleTimes,
  frameMaxHeightForLane,
} from "@/lib/timelineLayout";

interface TimelineClipProps {
  clip: Clip;
  pixelsPerSecond?: number;
  laneHeight?: number;
  selected?: boolean;
  /** True while this clip is being dragged — hide the original, show the ghost instead. */
  dragging?: boolean;
  onSelect?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMovePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onRemove: () => void;
}

export function TimelineClip({
  clip,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  laneHeight = DEFAULT_TRACK_HEIGHT,
  selected = false,
  dragging = false,
  onSelect,
  onMovePointerDown,
  onRemove,
}: TimelineClipProps) {
  const clipHeight = clipHeightForLane(laneHeight);
  const deferredLaneHeight = useDeferredValue(laneHeight);
  const frameMaxHeight = frameMaxHeightForLane(deferredLaneHeight);
  const [frames, setFrames] = useState<(string | null)[]>([]);
  const slotWidth = filmstripIntervalWidthPx(pixelsPerSecond);

  const times = useMemo(() => {
    if (clip.media_kind === "audio") return [] as number[];
    if (clip.media_kind === "image") return [Math.max(0, clip.source_offset)];
    return filmstripSampleTimes(clip.source_offset, clip.duration);
  }, [clip.media_kind, clip.source_offset, clip.duration]);

  useEffect(() => {
    if (clip.media_kind === "audio") {
      setFrames([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      times.map((time) => api.getMediaFrame(clip.source_path, time, frameMaxHeight).catch(() => null)),
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
      className={`absolute flex cursor-grab select-none items-center overflow-hidden rounded-md text-xs text-white shadow-sm active:cursor-grabbing ${fallback} ${ring} ${
        dragging ? "opacity-30" : ""
      }`}
      style={{
        top: CLIP_INSET,
        height: clipHeight,
        left: clip.start * pixelsPerSecond,
        width: Math.max(clip.duration * pixelsPerSecond, 24),
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        // Kill any browser selection range Shift+click would create over thumbnails.
        window.getSelection()?.removeAllRanges();
        onSelect?.(e);
        // Modifier clicks are selection-only; plain press can start a move drag.
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          onMovePointerDown(e);
        }
      }}
    >
      {clip.media_kind !== "audio" && frames.some(Boolean) && (
        <div className="pointer-events-none absolute inset-0 flex overflow-hidden">
          {frames.map((url, index) => {
            const isLast = index === frames.length - 1;
            const remainingWidth = clip.duration * pixelsPerSecond - index * slotWidth;
            const width =
              clip.media_kind === "image"
                ? undefined
                : Math.max(0, isLast ? remainingWidth : Math.min(slotWidth, remainingWidth));

            return (
              <div
                key={`${clip.id}-frame-${index}`}
                className={`flex h-full shrink-0 items-stretch justify-start overflow-hidden ${
                  clip.media_kind === "image" ? "" : "border-r border-black/20"
                }`}
                style={width !== undefined ? { width } : undefined}
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    className="h-full w-auto max-w-none object-contain object-left"
                    draggable={false}
                  />
                ) : (
                  <div className={`h-full w-full ${fallback}`} />
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/10" />
      <button
        type="button"
        className="relative z-10 ml-auto rounded p-1 hover:bg-black/30"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
