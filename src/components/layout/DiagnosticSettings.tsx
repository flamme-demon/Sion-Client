import { useEffect, useId, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  obtenirDiagnostic, configurerDiagnostic, configurerCaptureDiagnostic, exporterDiagnostic, ouvrirDossierDiagnostic,
  type EtatDiagnostic,
} from "../../services/diagnosticService";

interface Props {
  toggleStyle: (active: boolean) => CSSProperties;
  toggleDotStyle: (active: boolean) => CSSProperties;
}

export function DiagnosticSettings({ toggleStyle, toggleDotStyle }: Props) {
  const { t } = useTranslation();
  const aide = useId();
  const aideCapture = useId();
  const [etat, setEtat] = useState<EtatDiagnostic | null>(null);
  const [operation, setOperation] = useState<"mode" | "capture" | "export" | "dossier" | null>(null);
  const [inclureCrashs, setInclureCrashs] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [exporte, setExporte] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    let enCours = false;
    let derniereLecture = 0;
    const recharger = () => {
      if (enCours || Date.now() - derniereLecture < 5000) return;
      enCours = true;
      derniereLecture = Date.now();
      obtenirDiagnostic().then((valeur) => { if (vivant) setEtat(valeur); })
        .catch((e: unknown) => { if (vivant) setErreur(String(e)); })
        .finally(() => { enCours = false; });
    };
    recharger();
    window.addEventListener("focus", recharger);
    return () => { vivant = false; window.removeEventListener("focus", recharger); };
  }, []);

  useEffect(() => {
    if (!etat?.actif || !etat.expire_a) return;
    let vivant = true;
    const minuterie = window.setTimeout(() => {
      obtenirDiagnostic().then((valeur) => { if (vivant) setEtat(valeur); }).catch(() => {});
    }, Math.max(1000, etat.expire_a * 1000 - Date.now() + 1000));
    return () => { vivant = false; window.clearTimeout(minuterie); };
  }, [etat?.actif, etat?.expire_a]);

  const occupe = operation !== null;
  const bouton: CSSProperties = {
    padding: "8px 14px", borderRadius: 10, border: "none", font: "inherit", fontSize: 13,
    background: "var(--color-surface-container-high)", color: "var(--color-on-surface)",
    cursor: occupe || !etat ? "default" : "pointer", opacity: occupe || !etat ? 0.6 : 1,
  };
  const executer = async (nom: NonNullable<typeof operation>, action: () => Promise<void>) => {
    if (occupe) return;
    setOperation(nom); setErreur(null); setExporte(null);
    try { await action(); }
    catch (e) { setErreur(String(e)); }
    finally {
      try { setEtat(await obtenirDiagnostic()); } catch { /* garder l'erreur de l'action */ }
      setOperation(null);
    }
  };
  const erreurAffichee = erreur?.includes("diagnostic_permission_refusee")
    ? t("diagnostic.permissionCancelled")
    : erreur && /(?:command.*not found|unknown command|not implemented)/i.test(erreur)
      ? t("diagnostic.restartRequired") : erreur;

  return <section style={{ marginBottom: 24, padding: 16, borderRadius: 16, background: "var(--color-surface-container)" }}>
    <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>{t("diagnostic.title")}</h3>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, color: "var(--color-on-surface)" }}>{t("diagnostic.verboseTitle")}</div>
        <div id={aide} style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "var(--color-on-surface-variant)" }}>
          {t("diagnostic.hint")}
        </div>
      </div>
      <button type="button" role="switch" aria-checked={etat?.actif ?? false} aria-label={t("diagnostic.verboseTitle")} aria-describedby={aide}
        disabled={occupe || !etat}
        onClick={() => void executer("mode", async () => { setEtat(await configurerDiagnostic(!etat?.actif)); })}
        style={{ ...toggleStyle(etat?.actif ?? false), flexShrink: 0, cursor: occupe || !etat ? "default" : "pointer", opacity: occupe || !etat ? 0.6 : 1 }}>
        <span aria-hidden="true" style={toggleDotStyle(etat?.actif ?? false)} />
      </button>
    </div>

    {etat?.plateforme === "windows" && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16 }}>
      <div>
        <div style={{ fontSize: 14, color: "var(--color-on-surface)" }}>{t("diagnostic.captureTitle")}</div>
        <div id={aideCapture} style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-on-surface-variant)", marginTop: 4 }}>{t("diagnostic.windowsHint")}</div>
      </div>
      <button type="button" role="switch" aria-checked={etat.capture_active} aria-label={t("diagnostic.captureTitle")} aria-describedby={aideCapture} disabled={occupe}
        onClick={() => void executer("capture", async () => { setEtat(await configurerCaptureDiagnostic(!etat.capture_active)); })}
        style={{ ...toggleStyle(etat.capture_active), flexShrink: 0, cursor: occupe ? "default" : "pointer", opacity: occupe ? 0.6 : 1 }}>
        <span aria-hidden="true" style={toggleDotStyle(etat.capture_active)} />
      </button>
    </div>}
    {etat?.plateforme === "linux" && <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-on-surface-variant)", margin: "12px 0 0" }}>{t(etat.capture_disponible ? "diagnostic.linuxAvailable" : "diagnostic.linuxUnavailable")}</p>}
    {etat && <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, fontSize: 12, color: "var(--color-on-surface-variant)" }}>
      <div role="status">{operation === "mode" || operation === "capture" ? t("diagnostic.applying") : etat.actif ? t("diagnostic.enabledUntil", { time: new Date(etat.expire_a * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : t("diagnostic.disabled")}</div>
      {etat.plateforme === "windows" && <div>{t(etat.capture_active ? "diagnostic.captureEnabled" : "diagnostic.captureDisabled")}</div>}
      {etat.rapports > 0 && <>
        <div>{t("diagnostic.reports", { count: etat.rapports, size: (etat.taille_rapports / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 }) })}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={inclureCrashs} disabled={occupe} onChange={(e) => setInclureCrashs(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
          {t("diagnostic.includeReports")}
        </label>
        {inclureCrashs && <div>{t("diagnostic.memoryPrivacy")}</div>}
      </>}
    </div>}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
      <button type="button" disabled={occupe || !etat} style={{ ...bouton, background: "var(--color-primary)", color: "var(--color-on-primary)" }}
        onClick={() => void executer("export", async () => { setExporte(await exporterDiagnostic(inclureCrashs && !!etat?.rapports)); })}>
        {t(operation === "export" ? "diagnostic.exporting" : "diagnostic.export")}
      </button>
      <button type="button" disabled={occupe || !etat} style={bouton} onClick={() => void executer("dossier", () => ouvrirDossierDiagnostic())}>{t("diagnostic.openLogs")}</button>
      {etat?.plateforme === "windows" && <button type="button" disabled={occupe} style={bouton} onClick={() => void executer("dossier", () => ouvrirDossierDiagnostic(true))}>{t("diagnostic.openReports")}</button>}
    </div>
    <p style={{ fontSize: 11, lineHeight: 1.5, color: "var(--color-on-surface-variant)", margin: "10px 0 0" }}>{t("diagnostic.localHint")}</p>
    {exporte && <div role="status" style={{ marginTop: 10, fontSize: 12, overflowWrap: "anywhere", color: "var(--color-green)" }}>{t("diagnostic.exported", { path: exporte })}</div>}
    {erreurAffichee && <div role="alert" style={{ marginTop: 10, fontSize: 12, overflowWrap: "anywhere", color: "var(--color-error)" }}>{erreurAffichee}</div>}
    {etat?.capture_erreur && <div style={{ marginTop: 10, fontSize: 12, overflowWrap: "anywhere", color: "var(--color-on-surface-variant)" }}>{t("diagnostic.linuxAccessError")} {etat.capture_erreur}</div>}
  </section>;
}
