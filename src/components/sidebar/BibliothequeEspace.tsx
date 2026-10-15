import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { chargerBibliothequeEspace, inviterBibliothequeEspace, modererBibliothequeEspace,
  type AccesBibliotheque, type MembreBibliotheque } from "../../services/bibliothequeEspaceService";
import { creerBibliotheque } from "../../services/espacesService";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { RefreshIcon } from "../icons";
import { UserAvatar } from "./UserAvatar";

type Liste = "membres" | "invitations" | "manquants" | "exclus";
const libelles: Record<Liste, string> = { membres: "libraryMembers", invitations: "libraryPending", manquants: "libraryMissing", exclus: "libraryExcluded" };
const messageErreur = (e: unknown) => e instanceof Error ? e.message : String(e);

export function BibliothequeEspace({ espaceId, onBusyChange }: { espaceId: string; onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const designation = useMatrixStore((s) => s.channels.find((c) => c.id === espaceId)?.boardRoomId);
  const [acces, setAcces] = useState<AccesBibliotheque | null>(null);
  const [chargement, setChargement] = useState(true);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [liste, setListe] = useState<Liste>("membres");
  const [cible, setCible] = useState<MembreBibliotheque | null>(null);
  const [raison, setRaison] = useState("");
  const [bannir, setBannir] = useState(false);
  const [creation, setCreation] = useState<string | null>(null);
  const vivant = useRef(false), generation = useRef(0), travail = useRef(false);
  const origine = useRef<HTMLButtonElement | null>(null);
  const signalerOccupation = useRef(onBusyChange);
  signalerOccupation.current = onBusyChange;
  const idListe = useId(), idConfirmation = useId();
  const charger = useCallback(async () => {
    const demande = ++generation.current;
    setChargement(true);
    try {
      const resultat = await chargerBibliothequeEspace(espaceId);
      if (vivant.current && demande === generation.current) setAcces(resultat);
    } catch (e) {
      if (vivant.current && demande === generation.current) setErreur((avant) => avant || messageErreur(e));
    } finally {
      if (vivant.current && demande === generation.current) setChargement(false);
    }
  }, [espaceId]);
  useEffect(() => {
    const requetes = generation;
    vivant.current = true;
    void charger();
    return () => { vivant.current = false; requetes.current++; };
  }, [charger, designation]);

  const executer = async (action: () => Promise<void>) => {
    if (travail.current || chargement) return;
    travail.current = true; setOccupe(true); signalerOccupation.current(true); setErreur(""); setInfo("");
    try { await action(); }
    catch (e) { if (vivant.current) setErreur(messageErreur(e)); }
    finally {
      if (vivant.current) {
        await charger();
        if (vivant.current) { setOccupe(false); signalerOccupation.current(false); }
      }
      travail.current = false;
    }
  };
  const inviter = (utilisateur?: string) => executer(async () => {
    if (!acces?.salon) return;
    const resultat = await inviterBibliothequeEspace(espaceId, acces.salon, utilisateur);
    if (!vivant.current) return;
    if (resultat.echecs.length) throw new Error(t("spaces.librarySyncPartial", { count: resultat.echecs.length }));
    setInfo(t("spaces.libraryInvited", { count: resultat.invitedCount }));
  });
  const annuler = () => { setCible(null); origine.current?.focus(); };
  const elements = acces?.[liste] ?? [];
  const disponible = !!acces?.salon;
  const attenteSync = !!creation && !disponible;
  return <section className="sion-bibliotheque-espace">
    <div className="sion-espaces-titre-liste"><h3>{t("spaces.library")}</h3>
      <button type="button" disabled={occupe || chargement} aria-label={t("spaces.libraryRefresh")}
        onClick={() => { setErreur(""); void charger(); }}><RefreshIcon />{t("spaces.refresh")}</button></div>
    {erreur && <p role="alert" className="sion-espaces-erreur">{erreur.startsWith("spaces.") ? t(erreur) : erreur}</p>}
    {info && <p role="status">{info}</p>}
    {chargement && <p role="status">{t("spaces.libraryLoading")}</p>}
    {!chargement && !acces && <p>{t("spaces.libraryUnavailable")}</p>}
    {attenteSync && <p role="status">{t("spaces.librarySyncing")}</p>}
    {acces && !disponible && !attenteSync && <>
      <p>{t("spaces.noLibrary")}</p>
      {acces.administrateur ? <button type="button" className="sion-espaces-primaire" disabled={occupe || chargement}
        onClick={() => void executer(async () => {
          const resultat = await creerBibliotheque(espaceId);
          if (!vivant.current) return;
          setCreation(resultat.roomId);
          if (resultat.echecs.length) throw new Error(t("spaces.librarySyncPartial", { count: resultat.echecs.length }));
          setInfo(t("spaces.libraryCreated"));
        })}>{t("spaces.createLibrary")}</button> : <p>{t("spaces.libraryAdminOnly")}</p>}
    </>}
    {acces && disponible && <>
      <p>{t("spaces.libraryShared")}<small className="sion-bibliotheque-identifiant">{acces.salon}</small></p>
      <div className="sion-bibliotheque-compteurs">
        {(["membres", "invitations", "manquants", "exclus"] as const).map((id) => <button key={id} type="button"
          data-bibliotheque-liste={id} aria-expanded={liste === id} aria-controls={idListe} disabled={occupe}
          onClick={() => { setListe(id); setCible(null); }}><strong>{acces[id].length}</strong>{t(`spaces.${libelles[id]}`)}</button>)}
      </div>
      {acces.peutInviter ? <button type="button" disabled={occupe || chargement || acces.manquants.length === 0}
        onClick={() => void inviter()}>{t("spaces.syncLibrary")}</button>
        : <p>{t(acces.administrateur ? "spaces.libraryInviteDenied" : "spaces.libraryAdminOnly")}</p>}
      {cible && <form className="sion-bibliotheque-confirmation" aria-labelledby={idConfirmation}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!occupe) annuler(); } }}
        onSubmit={(e) => { e.preventDefault(); void executer(async () => {
          await modererBibliothequeEspace(espaceId, acces.salon!, cible.userId, bannir ? "bannir" : "expulser", raison);
          if (vivant.current) { setCible(null); setInfo(t("spaces.libraryRemoved")); }
        }); }}>
        <h4 id={idConfirmation}>{t("spaces.libraryRemoveConfirm", { user: cible.displayName })}</h4>
        <p>{t("spaces.libraryRemoveScope")}</p>
        <label>{t("spaces.libraryReason")}<input autoFocus value={raison} onChange={(e) => setRaison(e.target.value)} /></label>
        {cible.peutBannir && <label className="sion-espaces-check"><input type="checkbox" checked={bannir} disabled={!cible.peutExpulser || occupe} onChange={(e) => setBannir(e.target.checked)} />{t("spaces.libraryPreventReturn")}</label>}
        <p>{t(bannir ? "spaces.libraryBanHelp" : "spaces.libraryKickHelp")}</p>
        <div className="sion-espaces-actions"><button type="button" onClick={annuler}>{t("auth.cancel")}</button>
          <button type="submit" className="sion-espaces-danger" data-confirmer-exclusion-bibliotheque>{t(bannir ? "spaces.libraryBan" : "spaces.libraryRemove")}</button></div>
      </form>}
      <h4>{t(`spaces.${libelles[liste]}`)} ({elements.length})</h4>
      <div id={idListe} className="sion-espaces-liste" aria-busy={chargement}>
        {elements.map((membre) => <div className="sion-espaces-ligne" key={membre.userId} data-bibliotheque-membre={membre.userId}>
          <UserAvatar name={membre.displayName} size="sm" speaking={false} />
          <span>{membre.displayName}<small>{membre.userId}</small>
            {liste === "exclus" && <small>{t(membre.banni ? "spaces.libraryBanned" : "spaces.libraryKicked")}</small>}</span>
          {liste === "manquants" && acces.peutInviter && <button type="button" disabled={occupe || chargement}
            onClick={() => void inviter(membre.userId)}>{t("spaces.invite")}</button>}
          {liste === "membres" && (membre.peutExpulser || membre.peutBannir) && <button type="button" className="sion-espaces-danger" disabled={occupe || chargement}
            onClick={(e) => { origine.current = e.currentTarget; setCible(membre); setRaison(""); setBannir(!membre.peutExpulser); }}>{t("spaces.libraryRemove")}</button>}
          {liste === "exclus" && membre.peutRetablir && <button type="button" disabled={occupe || chargement}
            onClick={() => void executer(async () => {
              await modererBibliothequeEspace(espaceId, acces.salon!, membre.userId, "retablir");
              if (vivant.current) setInfo(t("spaces.libraryRestored"));
            })}>{t("spaces.libraryRestore")}</button>}
        </div>)}
        {!elements.length && <p>{t("spaces.libraryListEmpty")}</p>}
      </div>
    </>}
    {occupe && <p role="status">{t("spaces.working")}</p>}
  </section>;
}
