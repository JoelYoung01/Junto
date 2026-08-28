import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_PIXELS_PER_SECOND,
  PLAYHEAD_FOLLOW_MARGIN_PX,
  TRACK_CONTENT_OFFSET,
  clampPixelsPerSecond,
  playheadLeftPx,
  timeFromTimelineX,
} from "@/lib/timelineLayout";

export type TimelineInteractionBusy = {
  scrubbing: boolean;
  draggingClip: boolean;
  resizingTracks: boolean;
};

export type UseTimelineInteractionsArgs = {
  /** Attach listeners once the timeline DOM exists. */
  enabled: boolean;
  getPlayhead: () => number;
  getDuration: () => number;
  setPlayhead: (seconds: number) => void | Promise<void>;
  isPlaying: () => boolean;
  togglePlay: () => void;
  setScrubbing: (scrubbing: boolean) => void;
  /** Live busy flags consulted by follow-scroll / wheel policy. */
  getBusy: () => TimelineInteractionBusy;
};

/**
 * Central timeline input controller: wheel pan/zoom/scrub, playhead drag,
 * spacebar play/pause, follow-scroll, and shared scroll/zoom helpers.
 *
 * Add new timeline gestures here so policy stays coherent.
 */
export function useTimelineInteractions({
  enabled,
  getPlayhead,
  getDuration,
  setPlayhead,
  isPlaying,
  togglePlay,
  setScrubbing,
  getBusy,
}: UseTimelineInteractionsArgs) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const playheadOverlayRef = useRef<HTMLDivElement | null>(null);

  const ppsRef = useRef(DEFAULT_PIXELS_PER_SECOND);
  const playheadFocusedRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const userGestureUntilRef = useRef(0);

  const getPlayheadRef = useRef(getPlayhead);
  const getDurationRef = useRef(getDuration);
  const setPlayheadRef = useRef(setPlayhead);
  const isPlayingRef = useRef(isPlaying);
  const togglePlayRef = useRef(togglePlay);
  const setScrubbingRef = useRef(setScrubbing);
  const getBusyRef = useRef(getBusy);

  useEffect(() => {
    getPlayheadRef.current = getPlayhead;
    getDurationRef.current = getDuration;
    setPlayheadRef.current = setPlayhead;
    isPlayingRef.current = isPlaying;
    togglePlayRef.current = togglePlay;
    setScrubbingRef.current = setScrubbing;
    getBusyRef.current = getBusy;
  });

  const markUserGesture = useCallback(() => {
    userGestureUntilRef.current = performance.now() + 1600;
  }, []);

  const withProgrammaticScroll = useCallback((fn: () => void) => {
    programmaticScrollRef.current = true;
    fn();
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  const paintPlayheadDom = useCallback((playheadSeconds: number) => {
    if (playheadOverlayRef.current) {
      playheadOverlayRef.current.style.left = `${playheadLeftPx(playheadSeconds, ppsRef.current)}px`;
    }
  }, []);

  useEffect(() => {
    ppsRef.current = pixelsPerSecond;
    paintPlayheadDom(getPlayheadRef.current());
  }, [pixelsPerSecond, paintPlayheadDom]);

  const followPlayheadInView = useCallback(
    (playheadSeconds: number) => {
      if (!isPlayingRef.current()) return;
      const busy = getBusyRef.current();
      if (busy.scrubbing || busy.draggingClip || busy.resizingTracks) return;
      if (performance.now() < userGestureUntilRef.current) return;

      const scroller = scrollRef.current;
      const canvas = canvasRef.current;
      if (!scroller || !canvas) return;

      const canvasLeftInContent =
        scroller.scrollLeft +
        canvas.getBoundingClientRect().left -
        scroller.getBoundingClientRect().left;
      const absX = canvasLeftInContent + playheadLeftPx(playheadSeconds, ppsRef.current);
      const margin = PLAYHEAD_FOLLOW_MARGIN_PX;
      const viewportRight = scroller.scrollLeft + scroller.clientWidth;
      if (absX <= viewportRight - margin) return;

      withProgrammaticScroll(() => {
        scroller.scrollLeft = Math.max(0, absX - scroller.clientWidth + margin);
      });
    },
    [withProgrammaticScroll],
  );

  const onTimelineScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    markUserGesture();
  }, [markUserGesture]);

  const panBy = useCallback(
    (deltaPx: number) => {
      const scroller = scrollRef.current;
      if (!scroller || deltaPx === 0) return;
      markUserGesture();
      scroller.scrollLeft += deltaPx;
    },
    [markUserGesture],
  );

  const scrubBy = useCallback(
    (deltaSeconds: number) => {
      if (deltaSeconds === 0) return;
      markUserGesture();
      void setPlayheadRef.current(getPlayheadRef.current() + deltaSeconds);
    },
    [markUserGesture],
  );

  const zoomAt = useCallback(
    (clientX: number, factor: number) => {
      const scroller = scrollRef.current;
      const canvas = canvasRef.current;
      if (!scroller || !canvas) return;

      const oldPps = ppsRef.current;
      const newPps = clampPixelsPerSecond(oldPps * factor);
      if (Math.abs(newPps - oldPps) < 0.05) return;

      const timeAtCursor = timeFromTimelineX(
        clientX,
        canvas.getBoundingClientRect().left,
        oldPps,
      );

      markUserGesture();
      ppsRef.current = newPps;
      setPixelsPerSecond(newPps);
      paintPlayheadDom(getPlayheadRef.current());

      requestAnimationFrame(() => {
        const desiredCanvasLeft = clientX - playheadLeftPx(timeAtCursor, newPps);
        const currentCanvasLeft = canvas.getBoundingClientRect().left;
        withProgrammaticScroll(() => {
          scroller.scrollLeft += currentCanvasLeft - desiredCanvasLeft;
        });
      });
    },
    [markUserGesture, paintPlayheadDom, withProgrammaticScroll],
  );

  const scrollTimeRangeIntoView = useCallback(
    (start: number, clipDuration: number) => {
      const scroller = scrollRef.current;
      if (!scroller) return;

      const pps = ppsRef.current;
      const left = TRACK_CONTENT_OFFSET + start * pps;
      const right = left + Math.max(clipDuration * pps, 24);
      const margin = 48;
      const viewLeft = scroller.scrollLeft;
      const viewRight = viewLeft + scroller.clientWidth;

      let nextLeft = viewLeft;
      if (right > viewRight - margin) {
        nextLeft = right - scroller.clientWidth + margin;
      } else if (left < viewLeft + margin) {
        nextLeft = Math.max(0, left - margin);
      }

      if (Math.abs(nextLeft - viewLeft) > 0.5) {
        withProgrammaticScroll(() => {
          scroller.scrollLeft = nextLeft;
        });
      }
    },
    [withProgrammaticScroll],
  );

  const playheadFromClientX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return getPlayheadRef.current();
    const rect = canvas.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        getDurationRef.current(),
        timeFromTimelineX(clientX, rect.left, ppsRef.current),
      ),
    );
  }, []);

  const beginPlayheadDrag = useCallback(
    (target: HTMLElement, pointerId: number) => {
      setScrubbingRef.current(true);
      target.setPointerCapture(pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        void setPlayheadRef.current(playheadFromClientX(moveEvent.clientX));
      };

      const onUp = () => {
        setScrubbingRef.current(false);
        target.releasePointerCapture(pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [playheadFromClientX],
  );

  const onRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      void setPlayheadRef.current(playheadFromClientX(event.clientX));
      beginPlayheadDrag(event.currentTarget, event.pointerId);
    },
    [beginPlayheadDrag, playheadFromClientX],
  );

  const onPlayheadHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      playheadFocusedRef.current = true;
      beginPlayheadDrag(event.currentTarget, event.pointerId);
    },
    [beginPlayheadDrag],
  );

  const onPlayheadFocus = useCallback(() => {
    playheadFocusedRef.current = true;
  }, []);

  const onPlayheadBlur = useCallback(() => {
    playheadFocusedRef.current = false;
  }, []);

  // Wheel: Ctrl/Cmd zoom → focused playhead scrub → horizontal pan.
  useEffect(() => {
    if (!enabled) return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomAt(event.clientX, factor);
        return;
      }

      if (playheadFocusedRef.current) {
        event.preventDefault();
        const deltaSeconds = (event.deltaY + event.deltaX) / ppsRef.current;
        scrubBy(deltaSeconds);
        return;
      }

      event.preventDefault();
      panBy(event.deltaX + event.deltaY);
    };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [enabled, panBy, scrubBy, zoomAt]);

  // Spacebar play/pause (skip when typing / in dialogs).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" && event.key !== " ") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable ||
          target.closest('[role="dialog"]')
        ) {
          return;
        }
      }
      event.preventDefault();
      togglePlayRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    pixelsPerSecond,
    ppsRef,
    scrollRef,
    canvasRef,
    playheadOverlayRef,
    programmaticScrollRef,
    paintPlayheadDom,
    followPlayheadInView,
    markUserGesture,
    onTimelineScroll,
    withProgrammaticScroll,
    scrollTimeRangeIntoView,
    panBy,
    zoomAt,
    scrubBy,
    playheadFromClientX,
    onRulerPointerDown,
    onPlayheadHandlePointerDown,
    onPlayheadFocus,
    onPlayheadBlur,
  };
}
