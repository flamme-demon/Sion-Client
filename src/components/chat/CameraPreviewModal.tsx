import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CameraIcon, CloseIcon } from "../icons";
import { CAMERA_PREVIEW_KEY, cameraDevices, enableCamera, previewCamera, stopCamera, useCameraStore, type CameraDevice } from "../../services/cameraService";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { CameraStream } from "./CameraStream";
import { CameraEffectsPanel } from "./CameraEffectsPanel";
import { cameraEffectsAvailable } from "../../services/cameraEffectsService";
import "./Camera.css";

export function CameraPreviewModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ready = useCameraStore((s) => s.ready);
  const busy = useCameraStore((s) => s.busy);
  const engineError = useCameraStore((s) => s.error);
  const published = useCameraStore((s) => s.published);
  const previewing = useCameraStore((s) => s.previewing);
  const keep = useRef(published);
  const [effectsOpen, setEffectsOpen] = useState(published);
  const [effectsAvailable, setEffectsAvailable] = useState(false);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    let live = true;
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    void cameraEffectsAvailable().then((available) => { if (live) setEffectsAvailable(available); });
    void cameraDevices().then((list) => {
      if (!live) return;
      setDevices(list);
      const saved = useSettingsStore.getState().cameraDeviceId;
      setSelected(list.find((d) => d.id === useCameraStore.getState().deviceId)?.id ?? list.find((d) => d.id === saved)?.id ?? list.find((d) => d.front)?.id ?? list[0]?.id ?? "");
    }).catch((e) => { if (live) setError(String(e)); }).finally(() => { if (live) setLoading(false); });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
      if (e.key === "Tab") {
        const focus = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled):not([tabindex='-1']),select:not(:disabled),input:not(:disabled):not([hidden]),[tabindex='0']") ?? []);
        const first = focus[0], last = focus.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      live = false; mounted.current = false; window.removeEventListener("keydown", key, true);
      if (!keep.current) void stopCamera().catch(() => {});
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    if (useCameraStore.getState().published && selected === useCameraStore.getState().deviceId) return;
    let live = true;
    keep.current = false;
    void previewCamera(selected).catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [selected]);
  const activate = async () => {
    try { await enableCamera(); if (mounted.current) { keep.current = true; onClose(); } }
    catch (e) { if (mounted.current) setError(String(e)); }
  };
  return createPortal(<div className="sion-camera-backdrop" onClick={onClose}>
    <div ref={dialog} className="sion-camera-dialog" data-effects-open={effectsOpen} role="dialog" aria-modal="true" aria-labelledby="camera-preview-title" onClick={(e) => e.stopPropagation()}>
      <header><h2 id="camera-preview-title"><CameraIcon />{t("camera.title")}</h2><button type="button" aria-label={t("chat.close")} onClick={onClose}><CloseIcon /></button></header>
      <p>{t(published ? "camera.effects.liveHint" : "camera.previewHint")}</p>
      <div className="sion-camera-modal-body">
      <div className="sion-camera-preview-layout"><section className="sion-camera-source">
      <div className="sion-camera-preview">
        <div className="sion-camera-preview-image">
        <CameraStream streamKey={CAMERA_PREVIEW_KEY} label={t("camera.preview")} />
        {!ready && <span>{loading || busy ? t("chat.loading") : !devices.length ? t("camera.noDevice") : t("camera.waiting")}</span>}
        </div>
        <button type="button" className="sion-camera-effects-toggle sion-camera-video-action absolute" disabled={!effectsAvailable} aria-expanded={effectsOpen} onClick={() => setEffectsOpen((open) => !open)}><span aria-hidden="true">✦</span>{t("camera.effects.title")}</button>
      </div>
      {!!devices.length && <label>{t("camera.device")}<select value={selected} onChange={(e) => { setError(null); setSelected(e.target.value); }}>{devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>}
      {!previewing && !busy && !loading && selected && <button type="button" className="sion-camera-import" data-camera-retry onClick={() => {
        setError(null); useCameraStore.setState({ error: null }); keep.current = false;
        void previewCamera(selected).catch((e) => { if (mounted.current) setError(String(e)); });
      }}>{t("camera.retry")}</button>}
      </section>{effectsOpen && effectsAvailable && <CameraEffectsPanel onError={setError} />}</div>
      {(error || engineError) && <p className="sion-camera-error" role="alert">{error || engineError}</p>}
      </div>
      <footer>{published ? <button type="button" data-camera-activate onClick={onClose}>{t("camera.effects.done")}</button> : <><button type="button" onClick={onClose}>{t("camera.cancel")}</button><button type="button" data-camera-activate disabled={!ready || busy || !!error || !!engineError} onClick={() => { void activate(); }}>{t("camera.activate")}</button></>}</footer>
    </div>
  </div>, document.body);
}
