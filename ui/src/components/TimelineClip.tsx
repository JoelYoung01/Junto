import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { api, Clip } from "@/api";
import {
  CLIP_INSET,
  DEFAULT_PIXELS_PER_SECOND,
  DEFAULT_TRACK_HEIGHT,
  clipHeightForLane,
  filmstripVisibleSlots,
  frameMaxHeightForLane,
} from "@/lib/timelineLayout";

interface TimelineClipProps {
  clip: Clip;
  pixelsPerSecond?: number;
  laneHeight?: number;
  selected?: boolean;
  /** True while this clip is being dragged — hide the original, show the ghost instead. */
  dragging?: boolean;
  /** Round the leading edge when nothing abuts this clip on the left. */
  roundStart?: boolean;
  /** Round the trailing edge when nothing abuts this clip on the right. */
  roundEnd?: boolean;
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
  roundStart = true,
  roundEnd = true,
  onSelect,
  onMovePointerDown,
  onRemove,
}: TimelineClipProps) {
  const clipHeight = clipHeightForLane(laneHeight);
  const deferredLaneHeight = useDeferredValue(laneHeight);
  const frameMaxHeight = frameMaxHeightForLane(deferredLaneHeight);
  const [frameByTime, setFrameByTime] = useState<Map<number, string | null>>(new Map());

  // Full-height thumbs are ~clipHeight wide when roughly square; use that to skip
  // 1s grid samples that would sit under the previous thumb.
  const slots = useMemo(() => {
    if (clip.media_kind === "audio") return [];
    return filmstripVisibleSlots({
      sourceOffset: clip.source_offset,
      duration: clip.duration,
      pixelsPerSecond,
      thumbWidthPx: clipHeight,
    });
  }, [clip.media_kind, clip.source_offset, clip.duration, pixelsPerSecond, clipHeight]);

  const fetchTimes = useMemo(() => {
    if (clip.media_kind === "image") {
      // Stills: one decode, reuse across visible slots.
      return slots.length > 0 ? [Math.max(0, clip.source_offset)] : [];
    }
    return slots.map((s) => s.sourceTime);
  }, [clip.media_kind, clip.source_offset, slots]);

  useEffect(() => {
    if (clip.media_kind === "audio" || fetchTimes.length === 0) {
      setFrameByTime(new Map());
      return;
    }
    let cancelled = false;
    void Promise.all(
      fetchTimes.map(async (time) => {
        const url = await api.getMediaFrame(clip.source_path, time, frameMaxHeight).catch(() => null);
        return [time, url] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setFrameByTime(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [clip.source_path, clip.media_kind, fetchTimes, frameMaxHeight]);

  const fallback = "bg-neutral-700";

  const ring = selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "";
  const rounding = [
    roundStart ? "rounded-l-md" : "rounded-l-none",
    roundEnd ? "rounded-r-md" : "rounded-r-none",
  ].join(" ");

  const resolveUrl = (sourceTime: number): string | null => {
    if (clip.media_kind === "image") {
      return frameByTime.get(Math.max(0, clip.source_offset)) ?? null;
    }
    return frameByTime.get(sourceTime) ?? null;
  };

  const hasAnyFrame = slots.some((s) => Boolean(resolveUrl(s.sourceTime)));

  return (
    <div
      className={`group/clip absolute flex cursor-grab select-none items-center overflow-hidden text-xs text-white shadow-sm active:cursor-grabbing ${fallback} ${rounding} ${ring} ${
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
      {clip.media_kind !== "audio" && hasAnyFrame && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {slots.map((slot, index) => {
            const url = resolveUrl(slot.sourceTime);
            if (!url) return null;
            const clipWidthPx = Math.max(clip.duration * pixelsPerSecond, 24);
            const nextLeft = slots[index + 1]?.leftPx ?? clipWidthPx;
            const maxWidth = Math.max(1, Math.min(clipHeight, nextLeft - slot.leftPx));
            return (
              <div
                key={`${clip.id}-frame-${slot.sampleIndex}`}
                className="absolute top-0 bottom-0 overflow-hidden border-r border-black/20"
                style={{ left: slot.leftPx, width: maxWidth }}
              >
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover object-center"
                  draggable={false}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/10" />
      <button
        type="button"
        className={`relative z-10 ml-auto rounded p-1 hover:bg-black/30 ${
          selected
            ? "opacity-100"
            : "pointer-events-none opacity-0 group-hover/clip:pointer-events-auto group-hover/clip:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Remove clip"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
