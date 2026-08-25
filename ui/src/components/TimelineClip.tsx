import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { api, Clip } from "@/api";

const PIXELS_PER_SECOND = 80;

interface TimelineClipProps {
  clip: Clip;
  onDragStart: () => void;
  onDragEnd: (event: React.MouseEvent<HTMLDivElement>) => void;
  onRemove: () => void;
}

export function TimelineClip({ clip, onDragStart, onDragEnd, onRemove }: TimelineClipProps) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (clip.media_kind === "audio") {
      setThumb(null);
      return;
    }
    let cancelled = false;
    void api
      .getMediaFrame(clip.source_path, clip.source_offset, 160)
      .then((url) => {
        if (!cancelled) setThumb(url);
      })
      .catch(() => {
        if (!cancelled) setThumb(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clip.source_path, clip.source_offset, clip.media_kind]);

  const fallback =
    clip.media_kind === "audio"
      ? "bg-amber-700"
      : clip.media_kind === "image"
        ? "bg-emerald-800"
        : "bg-blue-800";

  return (
    <div
      className={`absolute top-2 flex h-12 items-center overflow-hidden rounded-md text-xs text-white shadow-sm ${fallback}`}
      style={{
        left: clip.start * PIXELS_PER_SECOND,
        width: Math.max(clip.duration * PIXELS_PER_SECOND, 24),
        backgroundImage: thumb ? `url(${thumb})` : undefined,
        backgroundSize: thumb ? "auto 100%" : undefined,
        backgroundRepeat: thumb ? "repeat-x" : undefined,
        backgroundPosition: "left center",
      }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
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
