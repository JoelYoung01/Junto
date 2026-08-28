import { useMemo } from "react";

import { buildRulerTicks, timelineContentWidthPx } from "@/lib/timelineLayout";

interface TimelineRulerProps {
  duration: number;
  pixelsPerSecond: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function TimelineRuler({
  duration,
  pixelsPerSecond,
  onPointerDown,
}: TimelineRulerProps) {
  const width = timelineContentWidthPx(duration, pixelsPerSecond);
  const ticks = useMemo(
    () => buildRulerTicks(duration, pixelsPerSecond),
    [duration, pixelsPerSecond],
  );

  return (
    <div
      role="slider"
      aria-label="Timeline ruler"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, duration)}
      tabIndex={0}
      className="relative h-7 cursor-pointer touch-none select-none outline-none"
      style={{ width }}
      onPointerDown={onPointerDown}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border" />
      {ticks.map((tick) => (
        <div
          key={tick.time}
          className="pointer-events-none absolute bottom-0 flex flex-col items-center"
          style={{
            left: tick.x,
            transform: tick.time === 0 ? "none" : "translateX(-50%)",
          }}
        >
          {tick.label !== undefined && (
            <span className="mb-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">
              {tick.label}
            </span>
          )}
          <div
            className={
              tick.major ? "h-3 w-px bg-muted-foreground/50" : "h-1.5 w-px bg-muted-foreground/25"
            }
          />
        </div>
      ))}
      {duration > 0 && Math.abs(duration - Math.round(duration)) > 1e-6 && (
        <div
          className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-muted-foreground/25"
          style={{ left: duration * pixelsPerSecond }}
        />
      )}
    </div>
  );
}
