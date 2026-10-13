import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { choisirEspace } from "../../hooks/useEspaces";
import * as espaces from "../../services/espacesService";
import { findAdminRoom } from "../../services/adminCommandService";
import { findSoundboardRoom, inviteUser, leaveRoom } from "../../services/matrixService";
import { CloseIcon, HashIcon, HistoryIcon, PlusIcon, RefreshIcon, SettingsIcon, SoundboardIcon, UsersIcon } from "../icons";
import type { UtilisateurAnnuaire } from "../../services/matrixCore";
import { UserAvatar } from "./UserAvatar";
import { ChoixLogoEspace } from "./ChoixLogoEspace";
import { InvitationEspace } from "./InvitationEspace";
import { ConservationPanel } from "./ConservationPanel";
import { ParcourirSalonsEspace } from "./ParcourirSalonsEspace";
import { DepartEspace } from "./DepartEspace";
import "./GestionEspaces.css";

function CaseEspace({ cochee, onChange }: { cochee: boolean; onChange: (cochee: boolean) => void }) {
  return <span className="sion-espaces-case">
    <input type="checkbox" checked={cochee} onChange={(e) => onChange(e.target.checked)} />
    <span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 10 8 14 16 6" /></svg></span>
  </span>;
}

type RubriqueEspace = "general" | "salons" | "bibliotheque" | "membres" | "conservation" | "acces";
const rubriques = [
  { id: "general", cle: "spaces.general", Icone: SettingsIcon },
  { id: "salons", cle: "spaces.rooms", Icone: HashIcon },
  { id: "bibliotheque", cle: "spaces.library", Icone: SoundboardIcon },
  { id: "membres", cle: "spaces.members", Icone: UsersIcon },
  { id: "conservation", cle: "conservation.title", Icone: HistoryIcon },
  { id: "acces", cle: "spaces.access", Icone: PartageIcone },
] as const;
function PartageIcone() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>;
}

export function GestionEspaces() {
  const vue = useEspacesStore((s) => s.fenetre);
  const id = useEspacesStore((s) => s.espaceActif);
  const utilisateur = useMatrixStore((s) => s.currentUserId);
  if (!vue) return null;
  if (vue === "parcourir") return id ? <ParcourirSalonsEspace key={`${id}:${utilisateur}`} espaceId={id} /> : null;
  return <FenetreEspaces key={vue === "ajouter" ? `${vue}:${utilisateur}` : `${vue}:${id}:${utilisateur}`} vue={vue} espaceId={id} />;
}
function FenetreEspaces({ vue, espaceId }: { vue: "ajouter" | "gerer"; espaceId: string | null }) {
  const { t, i18n } = useTranslation(undefined, { bindI18n: "languageChanged loaded" });
  const channels = useMatrixStore((s) => s.channels);
  const espace = channels.find((c) => c.id === espaceId && c.isSpace);
  const premier = !channels.some((c) => c.isSpace);
  const espaceConnu = !!espace;
  const adhesion = espace?.membership;
  const [onglet, setOnglet] = useState<"creer" | "rejoindre">("rejoindre");
  const [rubrique, setRubrique] = useState<RubriqueEspace>("general");
  const [nom, setNom] = useState(vue === "gerer" ? espace?.name ?? "" : "");
  const [nomModifie, setNomModifie] = useState(false);
  const [sujet, setSujet] = useState(vue === "gerer" ? espace?.topic ?? "" : "");
  const [sujetModifie, setSujetModifie] = useState(false);
  const nomAffiche = vue === "gerer" && !nomModifie ? espace?.name ?? nom : nom;
  const sujetAffiche = vue === "gerer" && !sujetModifie ? espace?.topic ?? sujet : sujet;
  const [image, setImage] = useState<File>();
  const [publique, setPublique] = useState(false);
  const [adresse, setAdresse] = useState("");
  const [reprendre, setReprendre] = useState(premier);
  const [selection, setSelection] = useState<string[]>([]);
  const [migrationBoard, setMigrationBoard] = useState<string | null>(null);
  const [migrerBoard, setMigrerBoard] = useState(premier);
  const [gestion, setGestion] = useState(false);
  const [adminEspace, setAdminEspace] = useState(false);
  const [membres, setMembres] = useState<{ userId: string; displayName?: string; powerLevel: number }[]>([]);
  const [invitations, setInvitations] = useState<UtilisateurAnnuaire[] | null>(null);
  const [hierarchie, setHierarchie] = useState<espaces.SalonHierarchie[]>([]);
  const [nomSalon, setNomSalon] = useState("");
  const [vocal, setVocal] = useState(false);
  const [commun, setCommun] = useState(true);
  const [chiffre, setChiffre] = useState(false);
  const [ajoutSalon, setAjoutSalon] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [confirmerDepart, setConfirmerDepart] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const fermeture = useRef<HTMLButtonElement>(null);
  const enCours = useRef(false);
  const cree = useRef<string | null>(null);
  const fermer = () => { if (!enCours.current) useEspacesStore.getState().ouvrir(null); };
  const candidats = channels.filter((c) => !c.isSpace && !c.isDM && !c.isSoundboard && c.id !== findAdminRoom());
  useEffect(() => {
    if (import.meta.env.DEV && i18n && !i18n.exists("spaces.pendingInvitations")) void i18n.reloadResources().catch(() => {});
  }, [i18n]);

  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null;
    fermeture.current?.focus();
    return () => { if (origine?.isConnected) origine.focus(); };
  }, []);
  useEffect(() => {
    let vivant = true;
    if (vue === "ajouter" && premier) {
      void findSoundboardRoom().then((id) => { if (vivant) setMigrationBoard(id); }).catch(() => {});
    }
    if (vue === "gerer" && espaceId && espaceConnu && adhesion !== "invite") {
      void Promise.all([espaces.responsables(espaceId), espaces.membresEspace(espaceId), espaces.hierarchieEspace(espaceId), espaces.administrateurEspace(espaceId), espaces.invitationsEspace(espaceId)])
        .then(([g, m, h, a, i]) => { if (vivant) { setGestion(g); setMembres(m); setHierarchie(h); setAdminEspace(a); setInvitations(i); setErreur(""); } })
        .catch((e) => { if (vivant) setErreur(String(e)); });
    }
    return () => { vivant = false; };
  }, [vue, espaceId, espaceConnu, adhesion, premier]);

  const action = async (travail: () => Promise<void>) => {
    if (enCours.current) return;
    enCours.current = true; setOccupe(true); setErreur(""); setInfo("");
    try { await travail(); }
    catch (e) { const message = e instanceof Error ? e.message : String(e); setErreur(message.startsWith("spaces.") ? t(message) : message); }
    finally { enCours.current = false; setOccupe(false); }
  };
  const actualiser = async () => {
    if (!espaceId) return;
    const [m, h, i] = await Promise.all([espaces.membresEspace(espaceId), espaces.hierarchieEspace(espaceId), espaces.invitationsEspace(espaceId)]);
    setMembres(m); setHierarchie(h); setInvitations(i);
  };
  const joindre = (entree: string) => action(async () => {
    const { id } = await espaces.rejoindreEspace(entree);
    choisirEspace(id);
    useEspacesStore.getState().ouvrir("parcourir");
  });
  const creer = () => action(async () => {
    const id = cree.current ?? await espaces.creerEspace(nom, sujet, publique);
    cree.current = id;
    // Keep the created ID if linking fails so a retry does not create a second space.
    const repris = reprendre ? candidats.filter((c) => selection.includes(c.id)) : [];
    const invites = new Set<string>();
    for (const c of repris) {
      const commun = await espaces.lireEtat(c.id, "m.room.join_rules").then((r) => r?.join_rule === "public");
      if (commun) for (const m of await espaces.membresEspace(c.id)) invites.add(m.userId);
      await espaces.lierSalon(id, c.id, commun);
    }
    if (migrerBoard && migrationBoard) {
      for (const m of await espaces.membresEspace(migrationBoard)) invites.add(m.userId);
      await espaces.rattacherBibliotheque(id, migrationBoard);
    }
    const echecs: string[] = [];
    for (const user of invites) {
      if (user === useMatrixStore.getState().currentUserId) continue;
      try { await inviteUser(id, user); } catch { echecs.push(user); }
    }
    if (image) await espaces.modifierEspace(id, nom, sujet, image);
    choisirEspace(id);
    if (echecs.length) throw new Error(t("spaces.invitePartial", { count: echecs.length }));
    useEspacesStore.getState().ouvrir("gerer");
  });
  const invitesEspace = espace?.membership === "invite";
  const enfants = hierarchie.filter((r) => r.room_id !== espaceId && r.room_type !== "m.space");
  const changerRubrique = (id: RubriqueEspace) => {
    setRubrique(id); setConfirmerDepart(false);
    const contenu = dialog.current?.querySelector<HTMLElement>('.sion-espaces-contenu');
    if (contenu) contenu.scrollTop = 0;
  };
  useEffect(() => {
    const menu = dialog.current?.querySelector<HTMLElement>('.sion-espaces-menu');
    if (!menu || typeof ResizeObserver === "undefined") return;
    const ajuster = () => {
      const actif = menu.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!actif || menu.scrollWidth <= menu.clientWidth) return;
      const cadre = menu.getBoundingClientRect(), bouton = actif.getBoundingClientRect();
      const gauche = bouton.left - cadre.left - 4, droite = bouton.right - cadre.right + 4;
      if (gauche < 0) menu.scrollLeft += Math.floor(gauche);
      else if (droite > 0) menu.scrollLeft += Math.ceil(droite);
    };
    const observer = new ResizeObserver(ajuster);
    observer.observe(menu); ajuster();
    return () => observer.disconnect();
  }, [rubrique, vue, invitesEspace]);

  return createPortal(<div className="sion-espaces-fond" onClick={(e) => { if (e.target === e.currentTarget) fermer(); }}>
    <div className={`sion-espaces-dialogue${vue === "gerer" && !invitesEspace ? " sion-espaces-gestion" : ""}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="titre-espaces"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); fermer(); }
        if (e.key === "Tab") {
          const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
            .filter((element) => element.getClientRects().length > 0);
          const premier = elements[0], dernier = elements.at(-1);
          if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier?.focus(); }
          else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier?.focus(); }
        }
      }}>
      <header><span className="sion-espaces-entete-icone" aria-hidden="true">{vue === "gerer" && espace?.icon ? <img src={espace.icon} alt="" /> : <UsersIcon />}</span>
        <h2 id="titre-espaces">{vue === "ajouter" ? t("spaces.add") : espace?.name ?? t("spaces.title")}</h2>
        <button className="sion-espaces-fermer" type="button" ref={fermeture} disabled={occupe} aria-label={t("chat.close")} onClick={fermer}><CloseIcon /></button></header>
      {erreur && <p role="alert" className="sion-espaces-erreur sion-espaces-retour">{erreur}</p>}
      {info && <p role="status" className="sion-espaces-retour">{info}</p>}
      <fieldset disabled={occupe}>
      {vue === "ajouter" ? <>
        <nav aria-label={t("spaces.add")} className="sion-espaces-tabs">
          <button type="button" aria-pressed={onglet === "rejoindre"} onClick={() => setOnglet("rejoindre")}>{t("spaces.join")}</button>
          <button type="button" aria-pressed={onglet === "creer"} onClick={() => setOnglet("creer")}>{t("spaces.create")}</button>
        </nav>
        {onglet === "rejoindre" ? <form onSubmit={(e) => { e.preventDefault(); void joindre(adresse); }}>
          <p>{t("spaces.joinHelp")}</p><label>{t("spaces.address")}<input required value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="https://matrix.to/#/…" /></label>
          <div className="sion-espaces-actions"><button type="button" className="sion-espaces-annuler" onClick={fermer}>{t("auth.cancel")}</button>
            <button className="sion-espaces-primaire" type="submit">{t("spaces.join")}</button></div>
        </form> : <form onSubmit={(e) => { e.preventDefault(); void creer(); }}>
          <label>{t("spaces.name")}<input required value={nomAffiche} onChange={(e) => { setNomModifie(true); setNom(e.target.value); }} maxLength={255} /></label>
          <label>{t("spaces.description")}<textarea value={sujetAffiche} onChange={(e) => { setSujetModifie(true); setSujet(e.target.value); }} /></label>
          <ChoixLogoEspace image={image} onChange={setImage} />
          <div className="sion-espaces-option"><label className="sion-espaces-check"><input className="sion-espaces-interrupteur" type="checkbox" role="switch" checked={publique} onChange={(e) => setPublique(e.target.checked)} />{t("spaces.public")}</label>
            <p>{t("spaces.publicHelp")}</p></div>
          {premier && candidats.length > 0 && <><label className="sion-espaces-check"><CaseEspace cochee={reprendre} onChange={setReprendre} />{t("spaces.migrateRooms")}</label>
            {reprendre && <><p>{t("spaces.migrationHelp")}</p><div className="sion-espaces-liste">{candidats.map((c) => <label className="sion-espaces-check" key={c.id}><CaseEspace cochee={selection.includes(c.id)} onChange={(cochee) => setSelection((a) => cochee ? [...a, c.id] : a.filter((id) => id !== c.id))} />{c.name}</label>)}</div></>}
          </>}
          {premier && migrationBoard && <label className="sion-espaces-check"><CaseEspace cochee={migrerBoard} onChange={setMigrerBoard} />{t("spaces.migrateLibrary")}</label>}
          <div className="sion-espaces-actions"><button type="button" className="sion-espaces-annuler" onClick={fermer}>{t("auth.cancel")}</button>
            <button className="sion-espaces-primaire" type="submit"><PlusIcon />{t("spaces.create")}</button></div>
        </form>}
      </> : invitesEspace ? <><p>{t("spaces.invitation")}</p><button className="sion-espaces-primaire" onClick={() => void joindre(espaces.lienEspace(espaceId!))}>{t("spaces.accept")}</button>
        <button onClick={() => void action(async () => { await leaveRoom(espaceId!); choisirEspace(null); useEspacesStore.getState().ouvrir(null); })}>{t("spaces.decline")}</button></> : espaceId && <>
        <div className="sion-espaces-organisation">
          <nav className="sion-espaces-menu" role="tablist" aria-label={t("spaces.manage")}
            onKeyDown={(e) => {
              const index = rubriques.findIndex((r) => r.id === rubrique);
              const prochain = e.key === "Home" ? 0 : e.key === "End" ? rubriques.length - 1
                : ["ArrowDown", "ArrowRight"].includes(e.key) ? (index + 1) % rubriques.length
                : ["ArrowUp", "ArrowLeft"].includes(e.key) ? (index + rubriques.length - 1) % rubriques.length : null;
              if (prochain === null || occupe) return;
              e.preventDefault(); changerRubrique(rubriques[prochain].id);
              dialog.current?.querySelector<HTMLButtonElement>(`#espace-onglet-${rubriques[prochain].id}`)?.focus();
            }}>
            {rubriques.map(({ id, cle, Icone }) => <button key={id} id={`espace-onglet-${id}`} type="button" role="tab"
              aria-selected={rubrique === id} aria-controls={`espace-rubrique-${id}`} tabIndex={rubrique === id ? 0 : -1}
              onClick={() => changerRubrique(id)}><Icone /><span>{t(cle)}</span></button>)}
          </nav>
          <div className="sion-espaces-contenu" role="tabpanel" id={`espace-rubrique-${rubrique}`} aria-labelledby={`espace-onglet-${rubrique}`} tabIndex={0}>
        {rubrique === "conservation" && <ConservationPanel scopeId={espaceId} onBusyChange={(busy) => { enCours.current = busy; setOccupe(busy); }} />}
        {rubrique === "general" && <section><h3>{t("spaces.general")}</h3>{gestion ? <form onSubmit={(e) => { e.preventDefault(); void action(async () => { await espaces.modifierEspace(espaceId, nomAffiche, sujetAffiche, image); setInfo(t("spaces.saved")); }); }}>
          <label>{t("spaces.name")}<input required value={nomAffiche} onChange={(e) => { setNomModifie(true); setNom(e.target.value); }} /></label>
          <label>{t("spaces.description")}<textarea value={sujetAffiche} onChange={(e) => { setSujetModifie(true); setSujet(e.target.value); }} /></label>
          <ChoixLogoEspace image={image} imageActuelle={espace?.icon} onChange={setImage} />
          <div className="sion-espaces-actions"><button type="submit" className="sion-espaces-primaire">{t("spaces.save")}</button></div></form>
          : <div className="sion-espaces-identite">{espace?.icon && <img src={espace.icon} alt={t("spaces.logo")} />}<div><strong>{espace?.name}</strong><p>{espace?.topic || t("spaces.noDescription")}</p></div></div>}</section>}
        {rubrique === "salons" && <><section><h3>{t("spaces.rooms")}</h3><button onClick={() => useEspacesStore.getState().ouvrir("parcourir")}>{t("spaces.browseRooms")}</button>
          <div className="sion-espaces-liste">{enfants.map((r) => {
            const rejoint = channels.some((c) => c.id === r.room_id && c.membership !== "invite");
            const via = hierarchie.find((r) => r.room_id === espaceId)?.children_state?.find((e) => e.state_key === r.room_id)?.content.via ?? [];
            return <div className="sion-espaces-ligne" key={r.room_id}><span>{r.name ?? r.room_id}<small>{t(r.join_rule === "invite" ? "spaces.private" : "spaces.common")}</small></span>
              {!rejoint && <button onClick={() => void action(async () => { await espaces.rejoindreAvecVia(r.room_id, via); await actualiser(); })}>{t("spaces.join")}</button>}
              {gestion && <button onClick={() => void action(async () => { await espaces.retirerSalon(espaceId, r.room_id); await actualiser(); })}>{t("spaces.unlink")}</button>}
            </div>;
          })}</div>{enfants.length === 0 && <p>{t("spaces.noRooms")}</p>}
        </section>
          {gestion && <><section><h3>{t("spaces.newRoom")}</h3><form onSubmit={(e) => { e.preventDefault(); void action(async () => { await espaces.creerSalonDansEspace(espaceId, nomSalon, vocal, commun, chiffre); setNomSalon(""); await actualiser(); }); }}>
            <label>{t("spaces.roomName")}<input required value={nomSalon} onChange={(e) => setNomSalon(e.target.value)} /></label>
            <label className="sion-espaces-check"><CaseEspace cochee={vocal} onChange={setVocal} />{t("spaces.voice")}</label>
            <label className="sion-espaces-check"><CaseEspace cochee={commun} onChange={setCommun} />{t("spaces.commonRoom")}</label>
            <label className="sion-espaces-check"><CaseEspace cochee={chiffre} onChange={setChiffre} />{t("spaces.encryptedRoom")}</label>
            {chiffre && <p>{t("spaces.encryptedRoomHelp")}</p>}
            <div className="sion-espaces-actions"><button type="submit" className="sion-espaces-primaire"><PlusIcon />{t("spaces.newRoom")}</button></div></form></section>
            <section><h3>{t("spaces.existingRoom")}</h3><form onSubmit={(e) => { e.preventDefault(); void action(async () => { const regle = await espaces.lireEtat(ajoutSalon, "m.room.join_rules"); await espaces.lierSalon(espaceId, ajoutSalon, regle?.join_rule === "public"); setAjoutSalon(""); await actualiser(); }); }}>
              <label>{t("spaces.existingRoom")}<select required value={ajoutSalon} onChange={(e) => setAjoutSalon(e.target.value)}><option value="">{t("spaces.chooseRoom")}</option>{candidats.filter((c) => !(espace?.spaceChildren ?? []).includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <div className="sion-espaces-actions"><button type="submit">{t("spaces.link")}</button></div></form></section></>}
        </>}
        {rubrique === "bibliotheque" && <section><h3>{t("spaces.library")}</h3><p>{t(espace?.boardRoomId ? "spaces.libraryShared" : "spaces.noLibrary")}</p>
          {adminEspace ? <button onClick={() => void action(async () => { const resultat = await espaces.creerBibliotheque(espaceId); await actualiser(); if (resultat.echecs.length) throw new Error(t("spaces.librarySyncPartial", { count: resultat.echecs.length })); setInfo(t("spaces.saved")); })}>{t(espace?.boardRoomId ? "spaces.syncLibrary" : "spaces.createLibrary")}</button>
            : <p>{t("spaces.libraryAdminOnly")}</p>}
        </section>}
        {rubrique === "membres" && <><section><div className="sion-espaces-titre-liste"><h3>{t("spaces.members")}</h3>
          <button type="button" aria-label={t("spaces.refreshMembers")} onClick={() => void action(actualiser)}><RefreshIcon />{t("spaces.refresh")}</button></div>
          <div className="sion-espaces-liste">{membres.map((m) => <div className="sion-espaces-ligne" key={m.userId}><span>{m.displayName ?? m.userId}<small>{m.userId}</small></span>
          {gestion ? <select aria-label={t("spaces.roleFor", { user: m.displayName ?? m.userId })} value={m.powerLevel >= 100 ? 100 : m.powerLevel >= 50 ? 50 : 0} disabled={!Number.isFinite(m.powerLevel)} onChange={(e) => void action(async () => { const echecs = await espaces.changerRoleEspace(espaceId, m.userId, Number(e.target.value)); await actualiser(); if (echecs.length) throw new Error(t("spaces.rolePartial", { count: echecs.length })); })}>
            <option value={0}>{t("spaces.member")}</option><option value={50}>{t("spaces.moderator")}</option><option value={100}>{t("spaces.admin")}</option></select> : <small>{t(m.powerLevel >= 100 ? "spaces.admin" : m.powerLevel >= 50 ? "spaces.moderator" : "spaces.member")}</small>}
        </div>)}</div></section>
        <section className="sion-espaces-invitations"><h3>{t("spaces.pendingInvitations", { count: invitations?.length ?? 0 })}</h3>
          {invitations === null ? <p role="status">{t(erreur ? "spaces.invitationListUnavailable" : "spaces.loadingInvitations")}</p>
            : invitations.length === 0 ? <p>{t("spaces.noPendingInvitations")}</p>
            : <div className="sion-espaces-liste">{invitations.map((i) => <div className="sion-espaces-ligne" key={i.userId}>
              <UserAvatar name={i.displayName} avatarUrl={i.avatarUrl ?? undefined} speaking={false} size="md" />
              <span>{i.displayName}<small>{i.userId}</small></span><small className="sion-espaces-statut-invitation">{t("spaces.awaitingAcceptance")}</small>
            </div>)}</div>}
        </section>
        </>}
        {rubrique === "acces" && (confirmerDepart
          ? <DepartEspace espaceId={espaceId} action={action} onAnnuler={() => setConfirmerDepart(false)} />
          : <><section><h3>{t("spaces.share")}</h3><p>{t("spaces.shareHelp")}</p><input aria-label={t("spaces.share")} readOnly value={espaces.lienEspace(espaceId)} onFocus={(e) => e.currentTarget.select()} />
          <div className="sion-espaces-actions"><button onClick={() => void action(async () => { await navigator.clipboard.writeText(espaces.lienEspace(espaceId)); setInfo(t("spaces.copied")); })}>{t("spaces.copy")}</button></div></section>
        <section><h3>{t("spaces.leave")}</h3><p>{t("spaces.leaveHelp")}</p><button className="sion-espaces-danger" onClick={() => setConfirmerDepart(true)}>{t("spaces.leave")}</button></section></>)}
        {gestion && <section hidden={rubrique !== "membres"}><h3>{t("spaces.invite")}</h3><InvitationEspace membres={[...membres, ...(invitations ?? [])]} visible={rubrique === "membres"} disabled={occupe}
          onInvited={(profil) => setInvitations((avant) => [...(avant ?? []).filter((i) => i.userId !== profil.userId), profil])}
          onInvite={async (utilisateur) => {
            let envoyee = false;
            await action(async () => { await inviteUser(espaceId, utilisateur); envoyee = true; setInfo(t("spaces.invited")); });
            return envoyee;
          }} /></section>}
          </div>
        </div>
      </>}
      </fieldset>
      {occupe && <p role="status">{t("spaces.working")}</p>}
    </div>
  </div>, document.body);
}
