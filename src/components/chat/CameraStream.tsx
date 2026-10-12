import { useEffect, useRef } from "react";
import { isNativeVideoSurfaceAvailable, registerNativeVideoSurface, type VoiceNativeBinaryFrame } from "../../services/voiceNativeService";
import { subscribeVideoFrames } from "../../services/videoFramesService";

export function CameraStream({ streamKey, label }: { streamKey: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    let pendingFrame: VoiceNativeBinaryFrame | null = null;
    let drawing = false;
    const paint = async (frame: VoiceNativeBinaryFrame) => {
      pendingFrame = frame;
      if (drawing) return;
      drawing = true;
      try {
        while (pendingFrame && !disposed) {
          const next = pendingFrame; pendingFrame = null;
          const blob = new Blob([next.jpeg.slice().buffer], { type: "image/jpeg" });
          let image: CanvasImageSource;
          let release = () => {};
          if (typeof createImageBitmap === "function") {
            const bitmap = await createImageBitmap(blob); image = bitmap; release = () => bitmap.close();
          } else {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            try { await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url; }); }
            catch (error) { URL.revokeObjectURL(url); throw error; }
            image = img; release = () => URL.revokeObjectURL(url);
          }
          try {
            const canvas = ref.current;
            if (!canvas || disposed) continue;
            const w = Math.max(2, Math.round(canvas.clientWidth * devicePixelRatio)), h = Math.max(2, Math.round(canvas.clientHeight * devicePixelRatio));
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            const ctx = canvas.getContext("2d", { alpha: false });
            if (!ctx) continue;
            ctx.clearRect(0, 0, w, h);
            const scale = Math.min(w / next.width, h / next.height);
            ctx.drawImage(image, (w - next.width * scale) / 2, (h - next.height * scale) / 2, next.width * scale, next.height * scale);
          } finally { release(); }
        }
      } catch { /* La frame suivante remplace celle qui n'a pas été décodée. */ }
      finally { drawing = false; }
    };
    void isNativeVideoSurfaceAvailable().then(async (native) => {
      if (disposed || !ref.current) return;
      const close = native ? await registerNativeVideoSurface(ref.current, streamKey) : subscribeVideoFrames(streamKey, (frame) => { void paint(frame); });
      if (disposed) close(); else cleanup = close;
    }).catch((error) => console.warn("[Sion][caméra] aperçu indisponible", error));
    return () => { disposed = true; pendingFrame = null; cleanup?.(); };
  }, [streamKey]);
  return <canvas ref={ref} width={1} height={1} aria-label={label} className="sion-camera-stream" style={{ aspectRatio: "16 / 9" }} />;
}
