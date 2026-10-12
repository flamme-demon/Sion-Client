import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CameraFloating } from "./CameraFloating";
import { CameraStream } from "./CameraStream";
import { CameraFloatIcon } from "./CameraPipIcons";
import { closeVideoMeeting, selectedMeetingStreams, showVideoMeeting, toggleMeetingStream, useMeetingStreams, useVideoMeetingStore, type MeetingStream } from "../../hooks/useVideoMeeting";
import { openNativeVideoPip, useNativePip } from "../../hooks/useNativePip";
import { plateformeLocale, plateformeMobile } from "../../utils/plateforme";
import { CloseIcon } from "../icons";
import "./Camera.css";
import "./VideoMeeting.css";

const MeetingScreenTile = lazy(() => import("./ScreenShareView").then((m) => ({ default: m.MeetingScreenTile })));

function VideoGallery({ streams, focus }: { streams: MeetingStream[]; focus: string | null }) {
  const { t } = useTranslation();
  const featured = focus === null ? streams.find((s) => s.kind === "screen") : streams.find((s) => s.key === focus);
  const others = streams.filter((s) => s !== featured);
  const tile = (stream: MeetingStream) => <div className="sion-meeting-tile" key={stream.key} data-stream-key={stream.key}>
    {stream.kind === "screen" ? <Suspense fallback={null}><MeetingScreenTile identity={stream.key} name={stream.name} hasAudio={stream.hasAudio} onSelect={() => useVideoMeetingStore.setState({ focus: stream.key })} /></Suspense> : <>
      <CameraStream streamKey={stream.key} label={stream.name} />
      <button type="button" className="sion-meeting-label absolute" aria-label={t("meeting.focus", { name: stream.name })} onClick={() => useVideoMeetingStore.setState({ focus: stream.key })}><span>{stream.name}</span></button>
    </>}
  </div>;
  return <div className={`sion-meeting-gallery${featured && others.length ? " sion-meeting-featured" : ""}`}>
    {featured ? <>
      <div className="sion-meeting-main">{tile(featured)}</div>
      {!!others.length && <div className="sion-meeting-rail">{others.map(tile)}</div>}
    </> : <div className="sion-meeting-grid" style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(streams.length))}, minmax(0, 1fr))` }}>{streams.map(tile)}</div>}
  </div>;
}

/** Un seul hôte pour webcams ET partages, même si aucune webcam n'est active. */
export function VideoMeeting() {
  const { t } = useTranslation();
  const streams = useMeetingStreams();
  const state = useVideoMeetingStore();
  const pip = useNativePip();
  const [picking, setPicking] = useState(false);
  const selected = selectedMeetingStreams(streams, state.selection);
  const focus = state.focus && selected.some((s) => s.key === state.focus) ? state.focus : state.focus === "" ? "" : null;
  const config = JSON.stringify({ streams: selected.map((s) => ({ sender: s.key, name: s.name })), focus: focus ?? selected.find((s) => s.kind === "screen")?.key ?? null });
  const synced = useRef("");
  useEffect(() => {
    if (state.mode === "closed" && !pip.busy && pip.sources.length && streams.some((s) => pip.sources.includes(s.key))) {
      useVideoMeetingStore.setState({ mode: "system", selection: pip.sources, focus: null });
    }
  }, [state.mode, pip.busy, pip.sources, streams]);
  useEffect(() => {
    const toggle = () => { void (useVideoMeetingStore.getState().mode === "closed" ? showVideoMeeting("internal", streams) : closeVideoMeeting()); };
    window.addEventListener("sion-toggle-video-meeting", toggle);
    return () => window.removeEventListener("sion-toggle-video-meeting", toggle);
  }, [streams]);
  useEffect(() => {
    if (state.mode !== "system") { synced.current = ""; return; }
    if (pip.busy || !pip.sources.length || !selected.length || config === synced.current) return;
    synced.current = config;
    const value = JSON.parse(config) as { streams: { sender: string; name: string }[]; focus: string | null };
    void openNativeVideoPip(value.streams, value.focus).then((opened) => { if (!opened) synced.current = ""; });
  }, [config, state.mode, pip.busy, pip.sources.length, selected.length]);
  useEffect(() => {
    if (state.mode === "closed" || pip.busy) return;
    if (!selected.length || (state.mode === "system" && !pip.sources.length)) void closeVideoMeeting();
  }, [state.mode, selected.length, pip.sources.length, pip.busy]);

  if (state.mode === "closed" || !selected.length) return pip.error ? <span className="sion-camera-pip-error" role="status">{t("camera.pipUnavailable")}</span> : null;
  const systemAvailable = !plateformeMobile(plateformeLocale()) && !!window.__TAURI_INTERNALS__;
  const title = t("meeting.title");
  const controls = <>
    <button type="button" aria-label={t("meeting.grid")} title={t("meeting.grid")} aria-pressed={state.focus === ""} onClick={() => useVideoMeetingStore.setState({ focus: "" })}>▦</button>
    <button type="button" aria-label={t("meeting.choose")} title={t("meeting.choose")} aria-expanded={picking} onClick={() => setPicking((p) => !p)}>{selected.length}/{streams.length}</button>
  </>;
  const picker = picking && <div className="sion-meeting-picker absolute" role="group" aria-label={t("meeting.choose")}>
    <label><input type="checkbox" checked={state.selection === null} disabled={pip.busy} onChange={() => useVideoMeetingStore.setState({ selection: state.selection === null ? selected.map((s) => s.key) : null })} />{t("meeting.all")}</label>
    {streams.map((s) => <label key={s.key}><input type="checkbox" checked={selected.includes(s)} disabled={pip.busy || (selected.length === 1 && selected.includes(s))} onChange={() => toggleMeetingStream(s.key, streams)} /><span>{s.name} · {t(s.kind === "screen" ? "meeting.screen" : "meeting.camera")}</span><button type="button" disabled={pip.busy} onClick={() => useVideoMeetingStore.setState({ selection: [s.key], focus: s.key })}>{t("meeting.only")}</button></label>)}
  </div>;
  return <>
    {state.mode === "system" ? <div className="sion-meeting-controller">
      <strong>{title}</strong>{controls}
      <button type="button" disabled={pip.busy} aria-label={t("meeting.inApp")} title={t("meeting.inApp")} onClick={() => { void showVideoMeeting("internal", streams); }}><CameraFloatIcon /></button>
      <button type="button" disabled={pip.busy} aria-label={t("camera.dockBack")} onClick={() => { void closeVideoMeeting(); }}><CloseIcon /></button>
      {picker}
    </div> : createPortal(<CameraFloating name={title} controls={controls} busy={pip.busy} onClose={() => { void closeVideoMeeting(); }} onSystemPip={systemAvailable ? () => { void showVideoMeeting("system", streams); } : undefined}>
      <VideoGallery streams={selected} focus={focus} />{picker}
    </CameraFloating>, document.body)}
    {pip.error && <span className="sion-camera-pip-error" role="status">{t("camera.pipUnavailable")}</span>}
  </>;
}
