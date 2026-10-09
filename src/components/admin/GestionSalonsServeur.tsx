import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getRoomsList, banRoom } from "../../services/adminService";
import { findAdminRoom, sendAdminCommand } from "../../services/adminCommandService";
import { getMatrixClient } from "../../services/matrixService";
import { moteurRust } from "../../services/moteur";
import * as cacheRust from "../../services/cacheRust";
import { hierarchieEspace } from "../../services/espacesService";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { choisirEspace } from "../../hooks/useEspaces";
import { nomServeur } from "../../utils/nomServeur";
import { classerSalonsServeur, lireListeSalonsServeur, type InfoSalonServeur, type TypeSalonServeur } from "../../utils/salonsServeur";
import { CloseIcon, HashIcon, MessageBubbleIcon, ServerIcon, SoundboardIcon, SpeakerIcon, UsersIcon } from "../icons";
import "../sidebar/GestionEspaces.css";
import "./GestionSalonsServeur.css";

const groupes: TypeSalonServeur[] = ["espaces", "salons", "mp", "bibliotheques", "autres"];
const cles: Record<TypeSalonServeur, string> = {
  espaces: "admin.actions.sectionSpaces", salons: "admin.actions.sectionChannels", mp: "admin.actions.sectionDMs",
  bibliotheques: "admin.actions.sectionLibraries", autres: "admin.actions.sectionUnknown",
};
const icone = (type: TypeSalonServeur, vocal = false) => type === "espaces" ? <UsersIcon />
  : type === "mp" ? <MessageBubbleIcon /> : type === "bibliotheques" ? <SoundboardIcon />
  : type === "autres" ? <ServerIcon /> : vocal ? <SpeakerIcon /> : <HashIcon />;

export function GestionSalonsServeur({ onFermer }: { onFermer: () => void }) {
  const { t } = useTranslation(undefined, { bindI18n: "languageChanged loaded" });
  const id = useId();
  const channels = useMatrixStore((s) => s.channels);
  const serveur = useAuthStore((s) => nomServeur(s.credentials?.homeserverUrl));
  const [liste, setListe] = useState<InfoSalonServeur[]>([]);
  const [infos, setInfos] = useState<InfoSalonServeur[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<TypeSalonServeur | "tous">("tous");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [suppression, setSuppression] = useState<string | null>(null);
  const enCours = useRef(false);
  const dialogue = useRef<HTMLDivElement>(null);
  const fermeture = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null;
    fermeture.current?.focus();
    return () => { if (origine?.isConnected) origine.focus(); };
  }, []);
  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const salons = lireListeSalonsServeur(await getRoomsList());
        if (!vivant) return;
        setListe(salons); setChargement(false);
        // Lire la hiérarchie donne aussi les noms des salons non rejoints.
        const espaces = useMatrixStore.getState().channels.filter((c) => c.isSpace && c.membership !== "invite");
        const informations: InfoSalonServeur[] = [];
        for (let debut = 0; debut < espaces.length; debut += 4) {
          const reponses = await Promise.allSettled(espaces.slice(debut, debut + 4).map((e) => hierarchieEspace(e.id)));
          if (!vivant) return;
          for (const reponse of reponses) if (reponse.status === "fulfilled") {
            informations.push(...reponse.value.map((r) => ({ id: r.room_id, name: r.name, roomType: r.room_type })));
          }
          setInfos([...informations]);
        }
      } catch (e) {
        if (vivant) { console.warn("[Sion][admin] Liste des salons indisponible", e); setErreur("admin.actions.roomsLoadFailed"); }
      } finally { if (vivant) setChargement(false); }
    })();
    return () => { vivant = false; };
  }, []);
  const salons = useMemo(() => {
    const directs = new Set(channels.filter((c) => c.isDM).map((c) => c.id));
    if (!moteurRust()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contenu = getMatrixClient()?.getAccountData("m.direct" as any)?.getContent() as Record<string, string[]> | undefined;
      for (const ids of Object.values(contenu ?? {})) if (Array.isArray(ids)) for (const id of ids) directs.add(id);
    }
    return classerSalonsServeur(liste, channels, infos, directs, findAdminRoom());
  }, [liste, channels, infos]);
  const query = recherche.trim().toLocaleLowerCase();
  const visibles = salons.filter((r) => [r.name, r.id, ...r.espaceNoms].join(" ").toLocaleLowerCase().includes(query));
  const fermer = () => { if (!enCours.current) onFermer(); };
  const supprimer = async (salon: string) => {
    if (enCours.current) return;
    enCours.current = true; setSuppression(salon); setErreur("");
    try {
      const membres = moteurRust()
        ? (await cacheRust.detailsFrais(salon).catch(() => null))?.membres.map((m) => m.userId) ?? []
        : getMatrixClient()?.getRoom(salon)?.getJoinedMembers().map((m) => m.userId) ?? [];
      for (const membre of membres) {
        if (membre.includes("conduit")) continue;
        try { await sendAdminCommand(`!admin users force-leave-room ${membre} ${salon}`); } catch { /* Le blocage reste demandé au serveur. */ }
      }
      await banRoom(salon, true);
      setListe((avant) => avant.filter((r) => r.id !== salon)); setConfirmation(null);
    } catch (e) { console.warn("[Sion][admin] Suppression impossible", e); setErreur("admin.actions.roomDeleteFailed"); }
    finally { enCours.current = false; setSuppression(null); }
  };
  return createPortal(<div className="sion-espaces-fond" onClick={(e) => { if (e.target === e.currentTarget) fermer(); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); fermer(); }
      if (e.key !== "Tab") return;
      const elements = Array.from(dialogue.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
      const premier = elements[0], dernier = elements.at(-1);
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier?.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier?.focus(); }
    }}>
    <div className="sion-espaces-dialogue sion-gestion-serveur" ref={dialogue} role="dialog" aria-modal="true" aria-labelledby={`${id}-titre`} aria-describedby={`${id}-description`}>
      <header><span className="sion-espaces-entete-icone" aria-hidden="true"><ServerIcon /></span>
        <div className="sion-gestion-serveur-entete" style={{ flex: 1, minWidth: 0 }}><h2 id={`${id}-titre`}>{t("admin.actions.manageRooms")}</h2><small>{serveur}</small></div>
        <button type="button" className="sion-espaces-fermer" ref={fermeture} disabled={!!suppression} onClick={fermer} aria-label={t("chat.close")}><CloseIcon /></button></header>
      <p id={`${id}-description`}>{t("admin.actions.roomsScope")}</p>
      <input aria-label={t("admin.actions.searchRooms")} placeholder={t("admin.actions.searchRooms")} value={recherche} onChange={(e) => { setRecherche(e.target.value); setConfirmation(null); }} disabled={!!suppression} />
      <nav className="sion-gestion-serveur-filtres" aria-label={t("admin.actions.roomTypes")}>
        {(["tous", ...groupes] as const).map((type) => <button type="button" key={type} disabled={!!suppression} aria-pressed={filtre === type}
          onClick={() => { setFiltre(type); setConfirmation(null); }}>{t(type === "tous" ? "admin.actions.allRooms" : cles[type])} · {type === "tous" ? salons.length : salons.filter((r) => r.type === type).length}</button>)}
      </nav>
      {erreur && <p role="alert" className="sion-espaces-erreur">{t(erreur)}</p>}
      {chargement ? <p role="status">{t("settings.loadingSessions")}</p> : <div className="sion-gestion-serveur-liste">
        {groupes.filter((type) => filtre === "tous" || filtre === type).map((type) => {
          const lignes = visibles.filter((r) => r.type === type);
          if (!lignes.length) return null;
          return <div className="sion-gestion-serveur-groupe" key={type} data-type-salon={type}>
            <h3>{icone(type)}{t(cles[type])} · {lignes.length}</h3><div className="sion-gestion-serveur-lignes">{lignes.map((r) => <div key={r.id}>
              <div className="sion-gestion-serveur-ligne" data-salon-serveur={r.id}>
                <span className="sion-gestion-serveur-icone" aria-hidden="true">{icone(r.type, r.hasVoice)}</span>
                <div className="sion-gestion-serveur-texte"><strong>{r.name || t(r.type === "bibliotheques" ? "spaces.library" : "admin.actions.unknownRoomName")}</strong>
                  <small>{t(r.type === "salons" ? (r.hasVoice ? "channels.typeVoice" : "channels.typeText") : cles[r.type])}{r.espaceNoms.length > 0 && ` · ${r.espaceNoms.join(", ")}`}</small>
                  <small>{r.id}</small></div>
                <div className="sion-gestion-serveur-actions">
                  {r.type === "espaces" && channels.some((c) => c.id === r.id && c.isSpace) && <button type="button" disabled={!!suppression} onClick={() => { onFermer(); choisirEspace(r.id); useEspacesStore.getState().ouvrir("gerer"); }}>{t("spaces.manage")}</button>}
                  {r.type !== "mp" && <button type="button" className="sion-gestion-serveur-supprimer" disabled={!!suppression} aria-label={t("admin.actions.deleteNamedRoom", { name: r.name || r.id })} onClick={() => { setConfirmation(r.id); setErreur(""); }}>{t("admin.actions.deleteRoom")}</button>}
                </div>
              </div>
              {confirmation === r.id && <div className="sion-gestion-serveur-confirmation" role="group" aria-label={t("admin.actions.deleteNamedRoom", { name: r.name || r.id })}>
                <p>{t("admin.actions.confirmDeleteNamed", { name: r.name || r.id })}</p>
                <div className="sion-gestion-serveur-actions"><button type="button" disabled={!!suppression} onClick={() => setConfirmation(null)}>{t("auth.cancel")}</button>
                  <button type="button" className="sion-gestion-serveur-supprimer" disabled={!!suppression} onClick={() => void supprimer(r.id)}>{t("admin.actions.confirmYes")}</button></div>
              </div>}
            </div>)}</div>
          </div>;
        })}
        {!visibles.some((r) => filtre === "tous" || filtre === r.type) && !erreur && <p>{t(query ? "admin.actions.noMatchingRooms" : "admin.actions.noRooms")}</p>}
      </div>}
      <footer><button type="button" disabled={!!suppression} onClick={fermer}>{t("chat.close")}</button></footer>
    </div>
  </div>, document.body);
}
