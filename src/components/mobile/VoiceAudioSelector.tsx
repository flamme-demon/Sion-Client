import { useEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { HeadphoneIcon } from "../icons";
import { androidHeadsetAction, chooseAndroidVoiceAudio, readAndroidVoiceAudio, resumeAndroidVoiceAudio, setAndroidHeadsetAction, watchAndroidVoiceAudio } from "../../services/androidVoiceAudio";
import type { AndroidVoiceAudioDevice, AndroidVoiceAudioState, AndroidHeadsetAction } from "../../services/androidVoiceAudio";

export function VoiceAudioSelector({ connected, compact = false }: { connected: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<AndroidVoiceAudioState | null>(readAndroidVoiceAudio);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hook, setHook] = useState(androidHeadsetAction);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number }>({ left: 8, top: 8, maxHeight: 400 });
  useEffect(() => {
    if (!connected) return;
    setAndroidHeadsetAction(androidHeadsetAction());
    return watchAndroidVoiceAudio((next) => setState((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
  }, [connected]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); window.removeEventListener("resize", resize); };
  }, [open]);
  if (!connected || !state) return null;
  const label = (d?: AndroidVoiceAudioDevice) => d ?
    ["bluetooth", "wired", "usb", "hearingAid"].includes(d.type) ? `${t(`voiceAudio.${d.type}`)} · ${d.name}` : t(`voiceAudio.${d.type}`)
    : t("voiceAudio.automatic");
  const current = state.devices.find((d) => d.id === state.active);
  const choose = (id: string) => {
    const accepted = chooseAndroidVoiceAudio(id);
    // Choosing a route is an explicit request to resume; Android still blocks GSM calls.
    const resumed = !accepted || !state.interrupted || resumeAndroidVoiceAudio();
    setFailed(!accepted || !resumed);
  };
  const toggle = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(300, window.innerWidth - 32);
      const above = rect.top > window.innerHeight / 3;
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
        maxHeight: Math.max(80, Math.min(window.innerHeight * 0.6, above ? rect.top - 16 : window.innerHeight - rect.bottom - 16)) });
    }
    setOpen((value) => !value);
  };
  return <div style={{ position: "relative", marginLeft: "auto", flexShrink: 0 }}>
    <button ref={trigger} aria-label={t("voiceAudio.choose")} aria-expanded={open} aria-controls={id}
      onClick={toggle} title={label(current)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", border: "none", borderRadius: 8, cursor: "pointer", color: "var(--color-on-surface)", background: "var(--color-surface-container-highest)", maxWidth: compact ? 36 : 140 }}>
      <HeadphoneIcon />{!compact && <span style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(current)}</span>}
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={t("voiceAudio.choose")}
      style={{ position: "fixed", ...position, zIndex: 150, boxSizing: "border-box", width: "min(300px, calc(100vw - 32px))", overflowY: "auto", background: "var(--color-surface-container-high)", color: "var(--color-on-surface)", border: "1px solid var(--color-outline-variant)", borderRadius: 14, padding: 12, boxShadow: "0 6px 24px #0006" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("voiceAudio.choose")}</div>
      {[{ id: "auto", type: "automatic", name: "" }, ...state.devices].map((d) => <label key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", fontSize: 13 }}>
        <input type="radio" name="sion-audio-route" value={d.id} checked={state.selected === d.id} disabled={!state.running} onChange={() => choose(d.id)} />
        <span>{d.id === "auto" ? t("voiceAudio.automatic") : label(d)}</span>
      </label>)}
      <div role="status" style={{ fontSize: 12, marginTop: 6 }}>
        {state.interrupted ? t("voiceAudio.interrupted") : state.pending ? t("voiceAudio.switching") : state.running ? t("voiceAudio.active", { device: label(current) }) : t("voiceAudio.starting")}
      </div>
      {state.interrupted && <button type="button" onClick={() => setFailed(!resumeAndroidVoiceAudio())}
        style={{ border: "1px solid var(--color-outline-variant)", borderRadius: 6, background: "var(--color-surface-container)", color: "inherit", padding: "6px 10px", marginTop: 8 }}>{t("voiceAudio.resume")}</button>}
      {(failed || state.error) && <div role="alert" style={{ color: "var(--color-error)", fontSize: 12, marginTop: 6 }}>{t(state.interrupted || state.error === "focusFailed" ? "voiceAudio.focusFailed" : "voiceAudio.routeFailed")}</div>}
      <label style={{ display: "block", fontSize: 12, marginTop: 12 }}>{t("voiceAudio.headsetButton")}
        <select value={hook} onChange={(e) => { const action = e.target.value as AndroidHeadsetAction; setHook(action); setAndroidHeadsetAction(action); }}
          style={{ display: "block", width: "100%", marginTop: 6, padding: 6, color: "inherit", background: "var(--color-surface-container)", border: "1px solid var(--color-outline-variant)", borderRadius: 6 }}>
          <option value="mute">{t("voiceAudio.headsetMute")}</option><option value="disconnect">{t("voiceAudio.headsetDisconnect")}</option>
        </select>
      </label>
    </div>, document.body)}
  </div>;
}
