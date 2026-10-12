import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CameraIcon } from "../icons";
import { useAppStore } from "../../stores/useAppStore";
import { cameraAvailable, resetCamera, stopCamera, syncCamera, useCameraStore } from "../../services/cameraService";
import { getVoiceNativeStatus } from "../../services/voiceNativeService";
import "./Camera.css";

const CameraPreviewModal = lazy(() => import("./CameraPreviewModal").then((m) => ({ default: m.CameraPreviewModal })));

export function CameraLifecycle() {
  const connected = useAppStore((s) => s.connectedVoiceChannel);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | null = null;
    useCameraStore.setState({ identity: null });
    if (!connected) { resetCamera(); return; }
    const poll = async () => {
      try {
        await syncCamera();
        const state = useCameraStore.getState();
        if (state.previewing && state.error && !state.busy) {
          const error = state.error;
          await stopCamera();
          useCameraStore.setState({ error });
          useAppStore.getState().setFileError(error);
        }
      } catch { /* Une reconnexion rétablit l'état du moteur. */ }
      if (!disposed) timer = setTimeout(poll, useCameraStore.getState().previewing ? 400 : 2000);
    };
    void Promise.all([cameraAvailable(), getVoiceNativeStatus()]).then(([available, status]) => {
      if (disposed) return;
      useCameraStore.setState({ identity: status.identity });
      if (available) void poll();
    }).catch(() => {});
    void import("@tauri-apps/api/event").then(({ listen }) => listen<{ reason: string }>("voice-native-camera-failed", ({ payload }) => {
      if (disposed) return;
      useCameraStore.setState({ previewing: false, published: false, ready: false, error: payload.reason });
      useAppStore.getState().setFileError(payload.reason);
    })).then((close) => { if (disposed) close(); else unlisten = close; }).catch(() => {});
    return () => { disposed = true; clearTimeout(timer); unlisten?.(); };
  }, [connected]);
  return null;
}

export function CameraButton() {
  const { t } = useTranslation();
  const enabled = useCameraStore((s) => s.published);
  const available = useCameraStore((s) => s.available);
  const busy = useCameraStore((s) => s.busy);
  const [preview, setPreview] = useState(false);
  const label = enabled ? t("camera.stop") : available === false ? t("camera.unavailable") : t("camera.start");
  return <>
    <button type="button" className="sion-chat-camera" aria-label={label} title={label} aria-pressed={enabled}
      disabled={!available || busy} onClick={() => { if (enabled) void stopCamera().catch((e) => useAppStore.getState().setFileError(String(e))); else setPreview(true); }}><CameraIcon off={!enabled} /></button>
    {preview && <Suspense fallback={null}><CameraPreviewModal onClose={() => setPreview(false)} /></Suspense>}
  </>;
}
