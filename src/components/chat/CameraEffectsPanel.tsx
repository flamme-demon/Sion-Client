import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyCameraEffects, getCameraEffectsStatus, importCameraBackground, savedCameraEffects } from "../../services/cameraEffectsService";
import { DEFAULT_CAMERA_EFFECTS, type CameraAccessory, type CameraBackground, type CameraEffects, type CameraFilter } from "../../types/cameraEffects";

const EFFECT_TABS = ["background", "filter", "adjustments", "accessory"] as const;

export function CameraEffectsPanel({ onError }: { onError: (error: string | null) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState<typeof EFFECT_TABS[number]>("background");
  const [settings, setSettings] = useState(savedCameraEffects);
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const status = await getCameraEffectsStatus(); if (!disposed) setPreparing(!status.ready && !status.error); } catch { /* le prochain tick reprend */ }
      if (!disposed) timer = setTimeout(poll, 800);
    };
    void poll();
    return () => { live.current = false; disposed = true; clearTimeout(timer); };
  }, []);
  const update = (patch: Partial<CameraEffects>) => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim();
    const next = { ...settings, ...patch, accent: /^#[\da-f]{6}$/i.test(accent) ? accent : settings.accent };
    setSettings(next); onError(null);
    const request = ++version.current;
    void applyCameraEffects(next).catch((error) => { if (live.current && request === version.current) { setSettings(savedCameraEffects()); onError(String(error)); } });
  };
  const upload = async (file: File) => {
    setUploading(true); onError(null);
    const request = ++version.current;
    try {
      const backgroundPath = await importCameraBackground(file);
      if (live.current && request === version.current) update({ background: "image", backgroundPath, backgroundName: file.name });
    } catch (error) { if (live.current && request === version.current) onError(String(error)); }
    finally { if (live.current) setUploading(false); }
  };
  const backgrounds: CameraBackground[] = ["none", "blur", "aurora", "sion", "image"];
  const filters: CameraFilter[] = ["none", "mono", "cinema", "vhs", "pixel"];
  const accessories: CameraAccessory[] = ["none", "glasses", "moustache", "laugh"];
  const faces = { none: "🙂", glasses: "😎", moustache: "🥸", laugh: "😂" };
  return <aside className="sion-camera-effects-pane" aria-label={t("camera.effects.title")} aria-busy={uploading}>
    <div className="sion-camera-effect-tabs" role="tablist" aria-label={t("camera.effects.title")}>
      {EFFECT_TABS.map((category) => <button type="button" key={category} id={`${id}-${category}`} role="tab" aria-selected={tab === category} aria-controls={`${id}-panel`} tabIndex={tab === category ? 0 : -1} onClick={() => setTab(category)} onKeyDown={(e) => {
        const index = EFFECT_TABS.indexOf(category);
        const next = e.key === "ArrowRight" ? (index + 1) % EFFECT_TABS.length : e.key === "ArrowLeft" ? (index + EFFECT_TABS.length - 1) % EFFECT_TABS.length : e.key === "Home" ? 0 : e.key === "End" ? EFFECT_TABS.length - 1 : null;
        if (next === null) return;
        e.preventDefault(); setTab(EFFECT_TABS[next]);
        document.getElementById(`${id}-${EFFECT_TABS[next]}`)?.focus();
      }}>{t(`camera.effects.${category}`)}</button>)}
    </div>
    <div className="sion-camera-effect-content" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
    {tab === "background" && <><div className="sion-camera-effect-grid">
      {backgrounds.map((background) => <button type="button" key={background} data-effect-background={background} aria-pressed={settings.background === background} disabled={uploading}
        onClick={() => background === "image" && !settings.backgroundPath ? input.current?.click() : update({ background })}>
        <span className={`sion-camera-effect-sample background-${background}`}>{background === "image" ? "＋" : background === "sion" ? <img src="/branding/logo.webp" alt="" /> : "🙂"}</span><span>{t(`camera.effects.backgrounds.${background}`)}</span>
      </button>)}
    </div>
      {settings.background === "blur" && <label className="sion-camera-effect-range">{t("camera.effects.blurStrength")}<input type="range" min="4" max="24" step="2" value={settings.blur} onChange={(e) => update({ blur: Number(e.target.value) })} /></label>}
      <button type="button" className="sion-camera-import" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? t("camera.effects.importing") : t("camera.effects.chooseBackground")}</button>
      {settings.background === "image" && settings.backgroundName && <p className="sion-camera-background-name" title={settings.backgroundName}>{settings.backgroundName}</p>}
    </>}
    {tab === "filter" && <div className="sion-camera-effect-grid">
      {filters.map((filter) => <button type="button" key={filter} data-effect-filter={filter} aria-pressed={settings.filter === filter} onClick={() => update({ filter })}><span className={`sion-camera-effect-sample filter-${filter}`}>🙂</span><span>{t(`camera.effects.filters.${filter}`)}</span></button>)}
    </div>}
    {tab === "adjustments" && <div className="sion-camera-effect-toggles">
      {(["light", "autoFrame", "outline"] as const).map((key) => <label key={key} data-enabled={settings[key]}>
        <span className="sion-camera-check"><input type="checkbox" checked={settings[key]} onChange={(e) => update({ [key]: e.target.checked })} /><span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 10 8 14 16 6" /></svg></span></span>
        <span>{t(`camera.effects.${key}`)}</span>
      </label>)}
    </div>}
    {tab === "accessory" && <div className="sion-camera-effect-grid accessories">
      {accessories.map((accessory) => <button type="button" key={accessory} data-effect-accessory={accessory} aria-pressed={settings.accessory === accessory} onClick={() => update({ accessory })}><span className="sion-camera-effect-sample">{faces[accessory]}</span><span>{t(`camera.effects.accessories.${accessory}`)}</span></button>)}
    </div>}
    </div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
    <div className="sion-camera-effect-bottom">
      {preparing && <p className="sion-camera-effects-preparing" role="status">{t("camera.effects.preparing")}</p>}
      <button type="button" className="sion-camera-reset" onClick={() => update({ ...DEFAULT_CAMERA_EFFECTS, backgroundPath: settings.backgroundPath, backgroundName: settings.backgroundName })}>{t("camera.effects.reset")}</button>
    </div>
  </aside>;
}
