/**
 * Minimal pointer-drag helper for in-app DnD (avoids HTML5 DnD so Tauri can
 * keep native OS file drops via dragDropEnabled).
 */

const DRAG_THRESHOLD_PX = 4;

export type PointerDragHandlers = {
  onMove: (event: PointerEvent, info: { dx: number; dy: number; dragging: boolean }) => void;
  onEnd: (event: PointerEvent, info: { dragging: boolean }) => void;
  onCancel?: () => void;
};

/** Start a document-level pointer gesture after optional move threshold. */
export function beginPointerDrag(
  startEvent: Pick<PointerEvent, "clientX" | "clientY" | "pointerId" | "button">,
  handlers: PointerDragHandlers,
): void {
  if (startEvent.button !== 0) return;

  const originX = startEvent.clientX;
  const originY = startEvent.clientY;
  let dragging = false;

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== startEvent.pointerId) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    if (!dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      dragging = true;
    }
    handlers.onMove(event, { dx, dy, dragging });
  };

  const finish = (event: PointerEvent) => {
    if (event.pointerId !== startEvent.pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", onCancel);
    handlers.onEnd(event, { dragging });
  };

  const onCancel = (event: PointerEvent) => {
    if (event.pointerId !== startEvent.pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", onCancel);
    handlers.onCancel?.();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", onCancel);
}
