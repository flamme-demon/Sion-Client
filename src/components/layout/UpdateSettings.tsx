import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { isMissingUpdaterCommand } from "../../utils/updateError";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUpdateStore } from "../../stores/useUpdateStore";

interface Props {
  toggleStyle: (active: boolean) => CSSProperties;
  toggleDotStyle: (active: boolean) => CSSProperties;
}

export function UpdateSettings({ toggleStyle, toggleDotStyle }: Props) {
  const { t } = useTranslation();
  const experimental = useSettingsStore((s) => s.experimentalUpdates);
  const setExperimental = useSettingsStore((s) => s.setExperimentalUpdates);
  const { status, update, error, check } = useUpdateStore();
  const busy = ["checking", "downloading", "installing", "permission"].includes(status);
  return <div style={{ marginBottom: 24, background: "var(--color-surface-container)", borderRadius: 16, padding: 16 }}>
    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)", marginBottom: 14 }}>{t("update.title")}</div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ marginRight: 12 }}>
        <div style={{ fontSize: 14, color: "var(--color-on-surface)" }}>{t("update.experimental")}</div>
        <div id="update-experimental-hint" style={{ fontSize: 12, color: "var(--color-on-surface-variant)", marginTop: 2, lineHeight: 1.5 }}>{t("update.experimentalHint")}</div>
      </div>
      <button type="button" role="switch" aria-checked={experimental} aria-label={t("update.experimental")} aria-describedby="update-experimental-hint"
        disabled={busy} onClick={() => setExperimental(!experimental)}
        style={{ ...toggleStyle(experimental), cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
        <span aria-hidden="true" style={toggleDotStyle(experimental)} />
      </button>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--color-on-surface-variant)" }}>
      <span>{t("update.current", { version: __APP_VERSION__ })}</span>
      <button style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "var(--color-surface-container-high)", color: "var(--color-on-surface)", font: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void check(true)}>{status === "checking" ? t("update.checking") : t("update.check")}</button>
      {status === "idle" && <span role="status">{t("update.upToDate")}</span>}
      {update && <span>{t("update.available", { version: update.version })}</span>}
    </div>
    {status === "error" && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)" }}>{isMissingUpdaterCommand(error) ? t("update.restartRequired") : <>{t("update.failed")} {error}</>}</p>}
  </div>;
}
