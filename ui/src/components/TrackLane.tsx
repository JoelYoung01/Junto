import { Clip, Track } from "@/api";
import { TimelineClip } from "@/components/TimelineClip";
import { useVerticalPointerDrag } from "@/hooks/usePointerDrag";
import {
  DEFAULT_TRACK_HEIGHT,
  PIXELS_PER_SECOND,
  clampTrackHeight,
} from "@/lib/timelineLayout";

interface TrackLaneProps {
  track: Track;
  clips: Clip[];
  laneHeight: number;
  playhead: number;
  selectedClipId: string | null;
  onResize: (trackId: string, deltaY: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onSelectClip: (clipId: string) => void;
  onClipDragStart: (clipId: string) => void;
  onClipDragEnd: (clip: Clip, event: React.MouseEvent<HTMLDivElement>) => void;
  onRemoveClip: (clipId: string) => void;
}

export function TrackLane({
  track,
  clips,
  laneHeight,
  playhead,
  selectedClipId,
  onResize,
  onResizeStart,
  onResizeEnd,
  onDragOver,
  onDrop,
  onSelectClip,
  onClipDragStart,
  onClipDragEnd,
  onRemoveClip,
}: TrackLaneProps) {
  const onResizePointerDown = useVerticalPointerDrag(
    (deltaY) => onResize(track.id, deltaY),
    { onStart: onResizeStart, onEnd: onResizeEnd },
  );

  return (
    <div className="mb-3 grid grid-cols-[110px_1fr] items-start gap-3">
      <div className="sticky left-0 z-10 bg-background pr-2 pt-2 text-sm text-muted-foreground">
        {track.name}
        <span className="ml-1 text-[10px] uppercase opacity-70">{track.kind}</span>
      </div>
      <div
        data-track-id={track.id}
        data-track-kind={track.kind}
        className="group relative rounded-lg border bg-muted/20"
        style={{ height: laneHeight }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            laneHeight={laneHeight}
            selected={clip.id === selectedClipId}
            onSelect={() => onSelectClip(clip.id)}
            onDragStart={() => onClipDragStart(clip.id)}
            onDragEnd={(e) => onClipDragEnd(clip, e)}
            onRemove={() => onRemoveClip(clip.id)}
          />
        ))}
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-rose-500"
          style={{ left: playhead * PIXELS_PER_SECOND }}
        />
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${track.name}`}
          className="absolute bottom-0 left-0 right-0 z-30 h-2 cursor-ns-resize touch-none"
          onPointerDown={onResizePointerDown}
        >
          <div className="mx-auto mt-1 h-0.5 w-10 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </div>
  );
}

export function trackLaneHeight(
  trackHeights: Record<string, number>,
  trackId: string,
): number {
  return trackHeights[trackId] ?? DEFAULT_TRACK_HEIGHT;
}

export function applyTrackHeightDelta(
  trackHeights: Record<string, number>,
  trackId: string,
  deltaY: number,
): Record<string, number> {
  const current = trackHeights[trackId] ?? DEFAULT_TRACK_HEIGHT;
  return {
    ...trackHeights,
    [trackId]: clampTrackHeight(current + deltaY),
  };
}
