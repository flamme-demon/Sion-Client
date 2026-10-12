import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../icons";
import { CAMERA_PREVIEW_KEY, useCameraStore } from "../../services/cameraService";
import { useNativePip } from "../../hooks/useNativePip";
import { closeVideoMeeting, showVideoMeeting, selectedMeetingStreams, useMeetingStreams, useVideoMeetingStore } from "../../hooks/useVideoMeeting";
import { plateformeLocale, plateformeMobile } from "../../utils/plateforme";
import { CameraStream } from "./CameraStream";
import { CameraFloatIcon, CameraSystemPipIcon } from "./CameraPipIcons";
import "./Camera.css";

const CameraPreviewModal = lazy(() => import("./CameraPreviewModal").then((m) => ({ default: m.CameraPreviewModal })));

export function CameraStrip() {
  const { t } = useTranslation();
  const local = useCameraStore((s) => s.published);
  const streams = useMeetingStreams();
  const tiles = streams.filter((s) => s.kind === "camera");
  const meeting = useVideoMeetingStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const pip = useNativePip();
  const systemPipAvailable = !plateformeMobile(plateformeLocale()) && !!window.__TAURI_INTERNALS__;
  const detached = new Set([...pip.sources, ...(meeting.mode === "internal" ? selectedMeetingStreams(streams, meeting.selection).map((s) => s.key) : [])]);
  const detach = () => { setSelected(null); void showVideoMeeting("internal", streams); };
  const detachSystem = async () => { await showVideoMeeting("system", streams); setSelected(null); };
  const pipActions = (key: string, name: string) => <>
    <button type="button" disabled={pip.busy} aria-label={t("camera.floatPip", { name })} title={t("camera.floatPip", { name })} aria-pressed={meeting.mode === "internal" && detached.has(key)} onClick={detach}><CameraFloatIcon /></button>
    {systemPipAvailable && <button type="button" aria-label={t("camera.systemPip", { name })} title={t("camera.systemPip", { name })} disabled={pip.busy} aria-pressed={pip.sources.includes(key)} onClick={() => { void detachSystem(); }}><CameraSystemPipIcon /></button>}
  </>;
  const expanded = tiles.find((tile) => tile.key === selected);
  const expandedKey = expanded?.key;
  useEffect(() => {
    if (!expandedKey) return;
    const previous = document.activeElement as HTMLElement | null;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setSelected(null); }
      if (e.key === "Tab") {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".sion-camera-expanded button:not(:disabled)"));
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("keydown", escape, true); if (previous?.isConnected) previous.focus(); };
  }, [expandedKey]);
  if (!tiles.length) return null;
  return <>
    <div className="sion-camera-strip" role="region" aria-label={t("camera.participants")}>
      {tiles.filter((tile) => !detached.has(tile.key)).map((tile) => <div className="sion-camera-tile" key={tile.key}>
        <div className="sion-camera-tile-preview">
          <>
              <button type="button" className="sion-camera-enlarge" aria-label={t("camera.enlarge", { name: tile.name })} onClick={() => setSelected(tile.key)}>
                <CameraStream streamKey={tile.key} label={tile.name} />
              </button>
              <div className="sion-camera-pip-actions absolute">{pipActions(tile.key, tile.name)}</div>
              {tile.key === CAMERA_PREVIEW_KEY && <button type="button" className="sion-camera-video-action absolute" aria-label={t("camera.effects.title")} title={t("camera.effects.title")} aria-haspopup="dialog" onClick={() => setEffectsOpen(true)}><span aria-hidden="true">✦</span></button>}
            </>
        </div>
        <span>{tile.name}</span>
      </div>)}
      {tiles.some((tile) => detached.has(tile.key)) && <div className="sion-camera-detached-summary">
        <button type="button" className="sion-meeting-detached" aria-label={t("camera.dockBack")} disabled={pip.busy} onClick={() => { void closeVideoMeeting(); }}><CameraFloatIcon /><span>{t("meeting.camerasDetached", { count: tiles.filter((tile) => detached.has(tile.key)).length })}</span></button>
        {local && <button type="button" className="sion-meeting-detached" aria-label={t("camera.effects.title")} onClick={() => setEffectsOpen(true)}>✦</button>}
      </div>}
    </div>
    {expanded && createPortal(<div className="sion-camera-backdrop" onClick={() => setSelected(null)}>
      <div className="sion-camera-expanded" role="dialog" aria-modal="true" aria-label={expanded.name} onClick={(e) => e.stopPropagation()}>
        <header><strong>{expanded.name}</strong><div className="sion-camera-expanded-actions">{pipActions(expanded.key, expanded.name)}<button type="button" autoFocus aria-label={t("chat.close")} onClick={() => setSelected(null)}><CloseIcon /></button></div></header>
        <div className="sion-camera-expanded-preview">
          <div><CameraStream streamKey={expanded.key} label={expanded.name} /></div>
          {expanded.key === CAMERA_PREVIEW_KEY && <button type="button" className="sion-camera-video-action absolute" aria-haspopup="dialog" onClick={() => { setSelected(null); setEffectsOpen(true); }}><span aria-hidden="true">✦</span>{t("camera.effects.title")}</button>}
        </div>
      </div>
    </div>, document.body)}
    {effectsOpen && local && <Suspense fallback={null}><CameraPreviewModal onClose={() => setEffectsOpen(false)} /></Suspense>}
  </>;
}
