import { forwardRef } from "react";

interface PlayheadOverlayProps {
  /** Used for a11y only — visual left is owned by the parent via ref + DOM updates. */
  playhead: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const PlayheadOverlay = forwardRef<HTMLDivElement, PlayheadOverlayProps>(
  function PlayheadOverlay({ playhead, onPointerDown, onFocus, onBlur }, ref) {
    return (
      <div
        ref={ref}
        className="pointer-events-none absolute inset-y-0 z-40 w-0 will-change-[left]"
        style={{ left: 0 }}
      >
        <div
          role="slider"
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuenow={playhead}
          tabIndex={0}
          className="pointer-events-auto absolute left-1/2 top-0 z-10 flex -translate-x-1/2 cursor-ew-resize touch-none flex-col items-center outline-none focus-visible:ring-2 focus-visible:ring-rose-400/80"
          onPointerDown={onPointerDown}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-rose-500 shadow-sm ring-2 ring-rose-500/30">
            <div
              className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-white"
              aria-hidden
            />
          </div>
        </div>
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-rose-500" />
      </div>
    );
  },
);
