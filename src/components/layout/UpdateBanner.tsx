import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateStore } from "../../stores/useUpdateStore";
import { isMissingUpdaterCommand } from "../../utils/updateError";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { openExternalUrl } from "../../utils/openExternal";
import "./UpdateBanner.css";
import { SUR_ANDROID } from "../../utils/plateforme";
import { DocumentMarkdown } from "../chat/MarkdownRenderer";

export function UpdateBanner() {
  const { t, i18n } = useTranslation();
  const state = useUpdateStore();
  const check = state.check;
  const experimental = useSettingsStore((s) => s.experimentalUpdates);
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      // Automatic searches refresh the cache without revealing a banner the
      // user dismissed. Manual and focus checks may otherwise shift its age.
      await check(false, { refresh: true });
      // Cache freshness starts when the request finishes. Starting the next
      // hour at that same point avoids reusing it for a second whole hour.
      if (!stopped) timer = setTimeout(() => { void refresh(); }, 60 * 60 * 1000);
    };
    const resume = () => {
      if (document.visibilityState === "visible" && useUpdateStore.getState().status !== "checking") void check();
    };
    void refresh();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [experimental, check]);

  const { update, status, stagedPath } = state;
  if (!update || state.dismissed) return null;
  const busy = ["checking", "downloading", "installing", "permission"].includes(status);
  const total = state.total && state.total > 0 ? state.total : null;
  const percent = total ? Math.max(0, Math.min(100, Math.floor(state.downloaded * 100 / total))) : null;
  const size = new Intl.NumberFormat(i18n?.resolvedLanguage || i18n?.language || "en", {
    style: "unit", unit: "megabyte", minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
  const downloadedSize = size.format(state.downloaded / 1_000_000);
  const transfer = total ? t("update.transfer", { downloaded: downloadedSize, total: size.format(total / 1_000_000) }) :
    t("update.received", { downloaded: downloadedSize });
  const channel = update.channel === "stable" ? "" : t(`update.channel.${update.channel}`);
  const message = status === "downloading" ? t("update.downloading", { version: update.version }) :
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
      {status === "downloading" && <div className="sion-update-transfer">
        <div className="sion-update-transfer-details">
          <span>{transfer}</span><span className="sion-update-percent">{percent === null ? "—" : `${percent} %`}</span>
        </div>
        <div className="sion-update-progress" role="progressbar" aria-label={t("update.download")}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={transfer}>
          <span className={`sion-update-progress-fill${percent === null ? " sion-update-progress-fill--pending" : ""}`}
            style={{ width: percent === null ? "30%" : `${percent}%` }} />
        </div>
      </div>}
      {status === "error" && <span role="alert">{isMissingUpdaterCommand(state.error) ? t("update.restartRequired") : <>{t("update.failed")} {state.error}</>}</span>}
      {!busy && <button onClick={() => void (stagedPath ? state.install() : state.download())}>
        {stagedPath ? (SUR_ANDROID ? t("update.install") : t("update.installRelaunch")) : t("update.download")}
      </button>}
      <button onClick={() => setNotesOpen(true)}>{t("update.notes")}</button>
      {status === "error" && stagedPath && <button onClick={() => void state.download()}>{t("update.redownload")}</button>}
      {status === "error" && <button onClick={() => void openExternalUrl(update.downloadUrl)}>{t("update.manual")}</button>}
      {!busy && <button onClick={state.dismiss}>{t("update.later")}</button>}
    </div>
    {notesOpen && <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 20 }}>
      <section className="sion-update-notes" role="dialog" aria-modal="true" aria-label={t("update.notes")} onKeyDown={(event) => { if (event.key === "Escape") setNotesOpen(false); }} style={{ background: "var(--color-surface)", color: "var(--color-on-surface)", padding: 24, borderRadius: 16, maxWidth: 650, width: "100%", maxHeight: "80vh", overflow: "auto" }}>
        {/* Keep close visible above long release notes. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <button className="sion-update-notes-close" autoFocus onClick={() => setNotesOpen(false)}
            title={t("update.close")} aria-label={t("update.close")}>✕</button>
          <span style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Sion {update.version}</span>
        </div>
        {/* GitHub release notes use Markdown; render its headings, emphasis and lists. */}
        <div style={{ overflowWrap: "anywhere", fontSize: 14, lineHeight: 1.5 }}>
          {update.notes ? <DocumentMarkdown content={update.notes} /> : t("update.noNotes")}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button onClick={() => void openExternalUrl(update.releaseUrl)}>{t("update.releasePage")}</button>
        </div>
      </section>
    </div>}
  </>;
}
