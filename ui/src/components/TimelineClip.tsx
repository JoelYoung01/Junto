import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { api, Clip } from "@/api";

const PIXELS_PER_SECOND = 80;
const FILMSTRIP_SAMPLES = 6;

interface TimelineClipProps {
  clip: Clip;
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
  selected = false,
  onSelect,
  onDragStart,
  onDragEnd,
  onRemove,
}: TimelineClipProps) {
  const [frames, setFrames] = useState<(string | null)[]>([]);

  const times = useMemo(() => {
    if (clip.media_kind === "audio") return [] as number[];
    const sampleCount =
      clip.media_kind === "image"
        ? 1
        : Math.min(
            FILMSTRIP_SAMPLES,
            Math.max(4, Math.ceil((clip.duration * PIXELS_PER_SECOND) / 48)),
          );
    return sampleTimes(clip.source_offset, clip.duration, sampleCount);
  }, [clip.media_kind, clip.source_offset, clip.duration]);

  useEffect(() => {
    if (clip.media_kind === "audio") {
      setFrames([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      times.map((time) => api.getMediaFrame(clip.source_path, time, 120).catch(() => null)),
    ).then((urls) => {
      if (!cancelled) setFrames(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [clip.source_path, clip.media_kind, times]);

  const fallback =
    clip.media_kind === "audio"
      ? "bg-amber-700"
      : clip.media_kind === "image"
        ? "bg-emerald-800"
        : "bg-blue-800";

  const ring = selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "";

  return (
    <div
      className={`absolute top-2 flex h-12 cursor-pointer items-center overflow-hidden rounded-md text-xs text-white shadow-sm ${fallback} ${ring}`}
      style={{
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
              <div
                key={`${clip.id}-frame-${index}`}
                className="h-full flex-1 bg-cover bg-center"
                style={{ backgroundImage: `url(${url})` }}
              />
            ) : (
              <div key={`${clip.id}-frame-${index}`} className={`h-full flex-1 ${fallback}`} />
            ),
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-black/10" />
      <span className="relative z-10 truncate px-2 drop-shadow">{clip.source_path.split("/").pop()}</span>
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
