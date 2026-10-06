import { broadcastCursor, broadcastCursorClick, broadcastCursorHide } from "./cursorService";

interface Options {
  target: string;
  contentRect: () => { left: number; top: number; width: number; height: number };
  markPointed: (identity: string) => void;
  suppressClick?: boolean;
}

/** Pointage tactile : le doigt déplace le curseur, un appui court émet une
 * onde. Les coordonnées excluent les bandes noires. La souris conserve ses
 * propres événements ; les clics synthétiques du toucher sont absorbés. */
export function attachTouchSharePointer(element: HTMLCanvasElement, options: Options): () => void {
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let inside = false;
  let lastSent = -Infinity;
  let lastTouch = -Infinity;
  const position = (event: PointerEvent) => {
    const rect = options.contentRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1
      ? { x, y } : null;
  };
  const hide = () => {
    if (inside) broadcastCursorHide(options.target);
    inside = false;
  };
  const send = (event: PointerEvent, force = false) => {
    const point = position(event);
    if (!point) { hide(); return; }
    const now = performance.now();
    if (!force && now - lastSent < 16) return;
    lastSent = now;
    inside = true;
    broadcastCursor(point.x, point.y, options.target);
    options.markPointed(options.target);
  };
  const down = (event: PointerEvent) => {
    if ((event.pointerType !== "touch" && event.pointerType !== "pen") || !event.isPrimary || pointer !== null) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    lastTouch = performance.now();
    event.preventDefault();
    element.setPointerCapture?.(pointer);
    send(event, true);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    moved ||= Math.hypot(event.clientX - startX, event.clientY - startY) > 10;
    send(event);
  };
  const finish = () => {
    const id = pointer;
    pointer = null;
    if (id !== null && element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
    hide();
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    lastTouch = performance.now();
    moved ||= Math.hypot(event.clientX - startX, event.clientY - startY) > 10;
    const point = position(event);
    if (!moved && point) broadcastCursorClick(point.x, point.y, options.target);
    finish();
  };
  const cancel = (event: PointerEvent) => { if (event.pointerId === pointer) finish(); };
  const click = (event: MouseEvent) => {
    if ((moved || options.suppressClick !== false) && performance.now() - lastTouch < 700) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const visibility = () => { if (document.hidden) finish(); };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("lostpointercapture", cancel);
  element.addEventListener("click", click, true);
  window.addEventListener("blur", finish);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("lostpointercapture", cancel);
    element.removeEventListener("click", click, true);
    window.removeEventListener("blur", finish);
    document.removeEventListener("visibilitychange", visibility);
    finish();
  };
}
