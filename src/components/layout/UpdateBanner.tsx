import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateStore } from "../../stores/useUpdateStore";
import { isMissingUpdaterCommand } from "../../utils/updateError";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppStore } from "../../stores/useAppStore";
import { openExternalUrl } from "../../utils/openExternal";
import "./UpdateBanner.css";
import { SUR_ANDROID } from "../../utils/plateforme";

export function UpdateBanner() {
  const { t } = useTranslation();
  const state = useUpdateStore();
  const check = state.check;
  const experimental = useSettingsStore((s) => s.experimentalUpdates);
  const inCall = useAppStore((s) => !!s.connectedVoiceChannel);
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    void check();
    const timer = setInterval(() => { void useUpdateStore.getState().check(); }, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [experimental, check]);

  const { update, status, stagedPath } = state;
  if (!update || state.dismissed) return null;
  const busy = ["checking", "downloading", "installing", "permission"].includes(status);
  const percent = state.total ? Math.min(100, Math.floor(state.downloaded * 100 / state.total)) : null;
  const channel = update.channel === "stable" ? "" : t(`update.channel.${update.channel}`);
  const message = status === "downloading" ? t("update.downloading", { progress: percent === null ? `${(state.downloaded / 1048576).toFixed(1)} Mo` : `${percent} %` }) :
    status === "installing" ? t("update.installing") : status === "permission" ? t("update.permission") :
    stagedPath ? t("update.ready", { version: update.version }) : t("update.available", { version: update.version });
  return <>
    <div className="sion-update-banner" role="region" aria-label={t("update.title")} style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, display: "flex", flexWrap: "wrap",
      alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 16px",
      background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 12,
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    }}>
      {channel && <strong>{channel}</strong>}
      <span role="status">{message}</span>
      {status === "error" && <span role="alert">{isMissingUpdaterCommand(state.error) ? t("update.restartRequired") : <>{t("update.failed")} {state.error}</>}</span>}
      {!busy && <button disabled={!!stagedPath && inCall} onClick={() => void (stagedPath ? state.install() : state.download())}>
        {stagedPath ? (SUR_ANDROID ? t("update.install") : t("update.installRelaunch")) : t("update.download")}
      </button>}
      {stagedPath && inCall && <span>{t("update.finishCall")}</span>}
      <button onClick={() => setNotesOpen(true)}>{t("update.notes")}</button>
      {status === "error" && stagedPath && <button onClick={() => void state.download()}>{t("update.redownload")}</button>}
      {status === "error" && <button onClick={() => void openExternalUrl(update.downloadUrl)}>{t("update.manual")}</button>}
      {!busy && <button onClick={state.dismiss}>{t("update.later")}</button>}
      {status === "downloading" && <progress aria-label={t("update.download")} value={percent ?? undefined} max={100} style={{ width: 100 }} />}
    </div>
    {notesOpen && <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 20 }}>
      <section className="sion-update-notes" role="dialog" aria-modal="true" aria-label={t("update.notes")} onKeyDown={(event) => { if (event.key === "Escape") setNotesOpen(false); }} style={{ background: "var(--color-surface)", color: "var(--color-on-surface)", padding: 24, borderRadius: 16, maxWidth: 650, width: "100%", maxHeight: "80vh", overflow: "auto" }}>
        <h2>Sion {update.version}</h2>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{update.notes || t("update.noNotes")}</div>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button onClick={() => void openExternalUrl(update.releaseUrl)}>{t("update.releasePage")}</button>
          <button autoFocus onClick={() => setNotesOpen(false)}>{t("update.close")}</button>
        </div>
      </section>
    </div>}
  </>;
}
