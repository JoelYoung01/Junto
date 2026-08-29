import { Clip, Track } from "@/api";
import { TimelineClip } from "@/components/TimelineClip";
import { useVerticalPointerDrag } from "@/hooks/usePointerDrag";
import {
  CLIP_INSET,
  DEFAULT_TRACK_HEIGHT,
  TRACK_GAP,
  TRACK_LABEL_WIDTH,
  clampTrackHeight,
  clipHeightForLane,
  clipsAbut,
  timelineContentWidthPx,
} from "@/lib/timelineLayout";

export interface DropGhost {
  start: number;
  duration: number;
}

interface TrackLaneProps {
  track: Track;
  clips: Clip[];
  /** Timeline duration used to size the content lane to the shared pixel scale. */
  timelineDuration: number;
  pixelsPerSecond: number;
  laneHeight: number;
  selectedClipIds: ReadonlySet<string>;
  draggingClipIds?: ReadonlySet<string>;
  dropGhosts?: DropGhost[];
  onResize: (trackId: string, deltaY: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
  onSelectClip: (clipId: string, event: React.PointerEvent) => void;
  onClipMovePointerDown: (clip: Clip, event: React.PointerEvent<HTMLDivElement>) => void;
  onRemoveClip: (clipId: string) => void;
}

export function TrackLane({
  track,
  clips,
  timelineDuration,
  pixelsPerSecond,
  laneHeight,
  selectedClipIds,
  draggingClipIds,
  dropGhosts = [],
  onResize,
  onResizeStart,
  onResizeEnd,
  onSelectClip,
  onClipMovePointerDown,
  onRemoveClip,
}: TrackLaneProps) {
  const onResizePointerDown = useVerticalPointerDrag(
    (deltaY) => onResize(track.id, deltaY),
    { onStart: onResizeStart, onEnd: onResizeEnd },
  );

  const ghostHeight = clipHeightForLane(laneHeight);
  const contentWidth = timelineContentWidthPx(timelineDuration, pixelsPerSecond);
  const ghostTone = track.kind === "audio" ? "bg-amber-500" : "bg-sky-500";
  const clipsByStart = [...clips].sort((a, b) => a.start - b.start);

  return (
    <div
      className="mb-3 grid items-start"
      style={{
        gridTemplateColumns: `${TRACK_LABEL_WIDTH}px ${contentWidth}px`,
        columnGap: TRACK_GAP,
      }}
      data-track-id={track.id}
      data-track-kind={track.kind}
    >
      <div
        className="sticky left-0 z-10 relative flex items-center self-stretch overflow-visible pl-4 text-sm text-muted-foreground"
        style={{ minHeight: laneHeight }}
      >
        {/* Soft scrim so scrolling clips dissolve under the label instead of a hard cutout. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 -right-3 bg-gradient-to-r from-background from-40% via-background/85 to-transparent"
        />
        <div className="relative z-[1] max-w-full truncate pr-1">
          {track.name}
          <span className="ml-1 text-[10px] uppercase opacity-70">{track.kind}</span>
        </div>
      </div>
      <div
        data-track-content
        className="group/lane relative overflow-hidden rounded-lg border bg-muted/20"
        style={{ height: laneHeight }}
      >
        {clipsByStart.map((clip, index) => {
          const prev = clipsByStart[index - 1] ?? null;
          const next = clipsByStart[index + 1] ?? null;
          return (
            <TimelineClip
              key={clip.id}
              clip={clip}
              pixelsPerSecond={pixelsPerSecond}
              laneHeight={laneHeight}
              selected={selectedClipIds.has(clip.id)}
              dragging={draggingClipIds?.has(clip.id) ?? false}
              roundStart={!clipsAbut(prev, clip)}
              roundEnd={!next || !clipsAbut(clip, next)}
              onSelect={(e) => onSelectClip(clip.id, e)}
              onMovePointerDown={(e) => onClipMovePointerDown(clip, e)}
              onRemove={() => onRemoveClip(clip.id)}
            />
          );
        })}
        {dropGhosts.map((ghost, index) => (
          <div
            key={`ghost-${track.id}-${index}-${ghost.start}`}
            aria-hidden
            className={`pointer-events-none absolute z-20 rounded-md ${ghostTone} opacity-50`}
            style={{
              top: CLIP_INSET,
              height: ghostHeight,
              left: ghost.start * pixelsPerSecond,
              width: Math.max(ghost.duration * pixelsPerSecond, 24),
            }}
          />
        ))}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${track.name}`}
          className="absolute bottom-0 left-0 right-0 z-30 h-2 cursor-ns-resize touch-none"
          onPointerDown={onResizePointerDown}
        >
          <div className="mx-auto mt-1 h-0.5 w-10 rounded-full bg-border opacity-0 transition-opacity group-hover/lane:opacity-100" />
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

/** Content lane element used for time ↔ x mapping (excludes the sticky label). */
export function trackContentEl(trackRow: Element): HTMLElement | null {
  return trackRow.querySelector("[data-track-content]");
}
