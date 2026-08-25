import { useCallback } from "react";

export function useVerticalPointerDrag(
  onDelta: (deltaY: number) => void,
  options?: { onStart?: () => void; onEnd?: () => void },
) {
  return useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      options?.onStart?.();

      let lastY = event.clientY;

      const onMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - lastY;
        lastY = moveEvent.clientY;
        if (deltaY !== 0) onDelta(deltaY);
      };

      const onUp = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        options?.onEnd?.();
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [onDelta, options],
  );
}
