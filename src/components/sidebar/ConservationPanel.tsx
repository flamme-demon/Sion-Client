import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HistoryIcon, RefreshIcon, ShieldIcon } from "../icons";
import { apercuConservation, enregistrerConservation, joursConservation, lireConservation, politiqueValide,
  type ApercuConservation, type ModificationConservation, type PolitiqueConservation, type SalonConservation, type VueConservation } from "../../services/conservationService";
import { ErreurApiAdmin } from "../../services/matrixCore";
import "./ConservationPanel.css";

function ChoixDuree({ salon, politique, disabled, onChange }: { salon: SalonConservation; politique: PolitiqueConservation;
  disabled: boolean; onChange: (p: PolitiqueConservation) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const choix = politique.mode !== "days" ? politique.mode : [30, 90, 365].includes(politique.days) ? String(politique.days) : "custom";
  const [personnalise, setPersonnalise] = useState(choix === "custom");
  return <div className="sion-conservation-choix">
    <label htmlFor={id}>{salon.name}</label>
    <select id={id} value={personnalise && politique.mode === "days" ? "custom" : choix} disabled={disabled}
      onChange={(e) => {
        const v = e.target.value; setPersonnalise(v === "custom");
        onChange(v === "inherit" && salon.parentId ? { mode: "inherit", parent: salon.parentId }
          : v === "unlimited" ? { mode: "unlimited" } : { mode: "days", days: v === "custom" ? 90 : Number(v) });
      }}>
      {salon.parentId && !salon.isSpace && <option value="inherit">{t("conservation.inherit", { name: salon.parentName })}</option>}
      <option value="unlimited">{t("conservation.unlimited")}</option>
      {[30, 90, 365].map((n) => <option key={n} value={n}>{t("conservation.days", { count: n })}</option>)}
      <option value="custom">{t("conservation.custom")}</option>
    </select>
    {personnalise && politique.mode === "days" && <label className="sion-conservation-personnalise">{t("conservation.customDays")}
      <input type="number" min="1" max="36500" step="1" required value={politique.days || ""} disabled={disabled}
        onChange={(e) => onChange({ mode: "days", days: Number(e.target.value) })} aria-invalid={!politiqueValide(politique)} />
    </label>}
  </div>;
}

export function ConservationPanel({ scopeId, onBusyChange }: { scopeId: string; onBusyChange?: (busy: boolean) => void }) {
  return <ConservationContenu key={scopeId} scopeId={scopeId} onBusyChange={onBusyChange} />;
}
function ConservationContenu({ scopeId, onBusyChange }: { scopeId: string; onBusyChange?: (busy: boolean) => void }) {
  const { t, i18n } = useTranslation(undefined, { bindI18n: "languageChanged loaded" });
  const [vue, setVue] = useState<VueConservation | null>(null);
  const [modifications, setModifications] = useState<ModificationConservation[]>([]);
  const [apercu, setApercu] = useState<ApercuConservation | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const [enregistre, setEnregistre] = useState(false);
  const verrou = useRef(false);
  const vivant = useRef(true);
  const lecture = useRef(0);
  useEffect(() => {
    if (import.meta.env.DEV && !i18n.exists("conservation.title")) void i18n.reloadResources().catch(() => {});
  }, [i18n]);
  useEffect(() => { vivant.current = true; return () => { vivant.current = false; }; }, []);
  const messageErreur = (e: unknown) => e instanceof ErreurApiAdmin
    ? e.errcode === "M_SION_PREVIEW_STALE" ? "conservation.previewExpired"
      : e.status === 403 ? "conservation.permissionDenied" : e.status === 409 ? "conservation.previewExpired" : "conservation.requestFailed"
    : e instanceof Error && e.message.startsWith("conservation.") ? e.message : "conservation.requestFailed";
  const action = async (travail: () => Promise<void>) => {
    if (verrou.current) return;
    verrou.current = true; setOccupe(true); onBusyChange?.(true); setErreur("");
    try { await travail(); }
    catch (e) { if (vivant.current) { setErreur(messageErreur(e)); setApercu(null); } }
    finally { verrou.current = false; if (vivant.current) { setOccupe(false); onBusyChange?.(false); } }
  };
  const charger = async () => {
    const numero = ++lecture.current;
    const nouvelle = await lireConservation(scopeId);
    if (!vivant.current || lecture.current !== numero) return;
    setVue(nouvelle); setModifications([]); setApercu(null); setEnregistre(false);
  };
  useEffect(() => {
    let annule = false;
    const numero = ++lecture.current;
    void lireConservation(scopeId).then((v) => { if (!annule && lecture.current === numero) setVue(v); })
      .catch((e) => { if (!annule && lecture.current === numero) setErreur(messageErreur(e)); });
    return () => { annule = true; };
  }, [scopeId]);
  const changer = (salon: SalonConservation, policy: PolitiqueConservation) => {
    setApercu(null); setEnregistre(false); setErreur("");
    setModifications((a) => [...a.filter((m) => m.roomId !== salon.id),
      ...(JSON.stringify(policy) === JSON.stringify(salon.policy) ? [] : [{ roomId: salon.id, policy }])]);
  };
  const politique = (salon: SalonConservation) => modifications.find((m) => m.roomId === salon.id)?.policy ?? salon.policy;
  const jours = (salon: SalonConservation): number | null => joursConservation(politique(salon),
    vue && salon.parentId === vue.scope.id ? joursConservation(politique(vue.scope)) : salon.effectiveDays);
  const valide = modifications.length > 0 && modifications.every((m) => politiqueValide(m.policy));
  const afficherSalon = (salon: SalonConservation) => <div className="sion-conservation-salon" key={salon.id}>
    {salon.protected ? <div className="sion-conservation-protection"><ShieldIcon /><div><strong>{salon.name}</strong><small>{t("conservation.permanent")}</small></div></div>
      : <><ChoixDuree salon={salon} politique={politique(salon)} disabled={occupe || !vue?.available || !salon.editable} onChange={(p) => changer(salon, p)} />
        <p>{jours(salon) === null ? t("conservation.keptForever") : t("conservation.effectiveDays", { count: jours(salon) })}</p>
        {vue?.available && !salon.editable && <small>{t("conservation.adminOnly")}</small>}</>}
  </div>;
  return <div className="sion-conservation" aria-busy={occupe}>
    <section><div className="sion-espaces-titre-liste"><h3>{t("conservation.title")}</h3><button type="button" disabled={occupe} onClick={() => void action(charger)}><RefreshIcon />{t("spaces.refresh")}</button></div>
      <p className="sion-conservation-introduction">{t("conservation.description")}</p>
      {!vue && !erreur && <p role="status">{t("conservation.loading")}</p>}
      {vue && <><div className="sion-conservation-statut" role="status"><HistoryIcon /><div>
        <strong>{t(!vue.available ? "conservation.unavailable" : vue.applying ? "conservation.active" : "conservation.previewMode")}</strong>
        <p>{t(!vue.available ? "conservation.unavailableHelp" : vue.applying ? "conservation.activeHelp" : "conservation.previewModeHelp")}</p>
        {vue.lastRun !== null && <small>{t("conservation.lastRun", { date: new Date(vue.lastRun).toLocaleString(i18n.language) })}</small>}
        {vue.lastFailed && <p>{t("conservation.lastFailed")}</p>}
      </div></div>{afficherSalon(vue.scope)}</>}
    </section>
    {!!vue?.rooms.length && <section><h3>{t("conservation.rooms")}</h3><div className="sion-conservation-salons">{vue.rooms.map(afficherSalon)}</div></section>}
    <section><div className="sion-conservation-protection"><ShieldIcon /><div><strong>{t("conservation.protectedTitle")}</strong><p>{t("conservation.protectedHelp")}</p></div></div></section>
    {apercu && <section className="sion-conservation-apercu" role="status"><h3>{t("conservation.previewTitle")}</h3>
      <p>{t("conservation.previewCounts", { messages: apercu.messages, files: apercu.files })}</p>
      <p>{t("conservation.protectedCount", { count: apercu.protectedFiles })}</p>
      {apercu.uncertainFiles > 0 && <p>{t("conservation.uncertainCount", { count: apercu.uncertainFiles })}</p>}
      {apercu.blockedMessages > 0 && <p>{t("conservation.blockedCount", { count: apercu.blockedMessages })}</p>}
      <small>{t("conservation.previewHelp")}</small>
    </section>}
    {erreur && <p className="sion-espaces-erreur" role="alert">{t(erreur)}</p>}
    {enregistre && <p role="status">{t("conservation.saved")}</p>}
    {vue?.available && <div className="sion-espaces-actions">
      <button type="button" disabled={occupe || !valide} onClick={() => void action(async () => {
        const resultat = await apercuConservation(scopeId, modifications);
        if (vivant.current) setApercu(resultat);
      })}>{t("conservation.preview")}</button>
      <button type="button" className="sion-espaces-primaire" disabled={occupe || !valide || !apercu}
        onClick={() => void action(async () => {
          if (!apercu || apercu.expiresAt <= Date.now()) { setApercu(null); throw new Error("conservation.previewExpired"); }
          const resultat = await enregistrerConservation(scopeId, modifications, apercu.revision);
          if (vivant.current) { setVue(resultat); setModifications([]); setApercu(null); setEnregistre(true); }
        })}>{t("spaces.save")}</button>
    </div>}
  </div>;
}
