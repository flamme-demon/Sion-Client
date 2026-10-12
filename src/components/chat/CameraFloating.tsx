import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../icons";
import { CameraSystemPipIcon } from "./CameraPipIcons";

type Rect = { x: number; y: number; width: number; height: number };
const MARGIN = 8;
function fit(rect: Rect): Rect {
  const width = Math.min(Math.max(200, rect.width), window.innerWidth - MARGIN * 2);
  const height = Math.min(Math.max(150, rect.height), window.innerHeight - MARGIN * 2);
  return { width, height, x: Math.min(Math.max(MARGIN, rect.x), window.innerWidth - width - MARGIN), y: Math.min(Math.max(MARGIN, rect.y), window.innerHeight - height - MARGIN) };
}

export function CameraFloating({ name, onClose, onSystemPip, busy, children, controls }: { name: string; onClose: () => void; onSystemPip?: () => void; busy: boolean; children: ReactNode; controls?: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState(() => fit({ x: window.innerWidth - 584, y: window.innerHeight - 394, width: 560, height: 370 }));
  const gesture = useRef<{ pointer: number; x: number; y: number; rect: Rect; resize: boolean } | null>(null);
  const current = useRef(rect);
  const raf = useRef<number | null>(null);
  const stopGesture = useRef<(() => void) | null>(null);
  useEffect(() => {
    const resize = () => {
      stopGesture.current?.(); gesture.current = null;
      if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
      setRect((before) => fit(before));
    };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); stopGesture.current?.(); if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, []);
  const start = (event: PointerEvent<HTMLButtonElement>, resize: boolean) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    stopGesture.current?.();
    current.current = rect;
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, rect, resize };
    // Le geste reste actif hors du bandeau et de la carte, y compris dans
    // les webviews qui ne conservent pas la capture du pointeur.
    const onMove = (pointer: globalThis.PointerEvent) => move(pointer);
    const onEnd = (pointer: globalThis.PointerEvent) => end(pointer);
    const onBlur = () => end({ pointerId: event.pointerId });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", onBlur);
    stopGesture.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", onBlur);
      stopGesture.current = null;
    };
  };
  const move = (event: Pick<globalThis.PointerEvent, "pointerId" | "clientX" | "clientY">) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    current.current = fit(g.resize ? { ...g.rect, width: g.rect.width + dx, height: g.rect.height + dy } : { ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy });
    if (raf.current === null) raf.current = requestAnimationFrame(() => {
      raf.current = null;
      if (ref.current) Object.assign(ref.current.style, { left: `${current.current.x}px`, top: `${current.current.y}px`, width: `${current.current.width}px`, height: `${current.current.height}px` });
    });
  };
  const end = (event: Pick<globalThis.PointerEvent, "pointerId">) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    stopGesture.current?.();
    gesture.current = null;
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    setRect(current.current);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, resize: boolean) => {
    const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (!delta) return;
    event.preventDefault();
    setRect((before) => fit(resize ? { ...before, width: before.width + delta[0], height: before.height + delta[1] } : { ...before, x: before.x + delta[0], y: before.y + delta[1] }));
  };
  return <div ref={ref} className="sion-camera-floating fixed" role="region" aria-label={t("camera.floating", { name })} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header>
      <button type="button" className="sion-camera-floating-drag" aria-label={t("camera.movePip")} title={t("camera.movePip")} onPointerDown={(event) => start(event, false)} onKeyDown={(event) => keyboard(event, false)}>{name}</button>
      {controls}
      {onSystemPip && <button type="button" disabled={busy} aria-label={t("camera.systemPip", { name })} title={t("camera.systemPip", { name })} onClick={onSystemPip}><CameraSystemPipIcon /></button>}
      <button type="button" disabled={busy} aria-label={t("camera.dockBack")} title={t("camera.dockBack")} onClick={onClose}><CloseIcon /></button>
    </header>
    <div className="sion-camera-floating-video">{children}</div>
    <button type="button" className="sion-camera-floating-resize absolute" aria-label={t("camera.resizePip")} title={t("camera.resizePip")} onPointerDown={(event) => start(event, true)} onKeyDown={(event) => keyboard(event, true)}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M11 3 3 11M11 7l-4 4" /></svg></button>
  </div>;
}
