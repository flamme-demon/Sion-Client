import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { choisirEspace } from "../../hooks/useEspaces";
import * as espaces from "../../services/espacesService";
import { findAdminRoom } from "../../services/adminCommandService";
import { findSoundboardRoom, inviteUser, leaveRoom } from "../../services/matrixService";
import { CloseIcon, ImageIcon, PlusIcon, UsersIcon } from "../icons";
import "./GestionEspaces.css";

function CaseEspace({ cochee, onChange }: { cochee: boolean; onChange: (cochee: boolean) => void }) {
  return <span className="sion-espaces-case">
    <input type="checkbox" checked={cochee} onChange={(e) => onChange(e.target.checked)} />
    <span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 10 8 14 16 6" /></svg></span>
  </span>;
}

function ChoixLogo({ image, onChange }: { image: File | undefined; onChange: (image: File | undefined) => void }) {
  const { t, i18n } = useTranslation(undefined, { bindI18n: "languageChanged loaded" });
  const fichier = useRef<HTMLInputElement>(null);
  // Une session dev déjà ouverte conserve son ancien dictionnaire après le HMR.
  useEffect(() => {
    if (import.meta.env.DEV && !i18n.exists("spaces.chooseLogo")) void i18n.reloadResources().catch(() => {});
  }, [i18n]);
  return <div className="sion-espaces-logo-champ">
    <span>{t("spaces.logo")}</span>
    <button type="button" className="sion-espaces-logo" onClick={() => fichier.current?.click()}>
      <span className="sion-espaces-logo-icone" aria-hidden="true"><ImageIcon /></span>
      <span><strong>{t("spaces.chooseLogo")}</strong><small>{image?.name ?? t("spaces.noLogo")}</small></span>
    </button>
    <input ref={fichier} hidden type="file" accept="image/*" aria-label={t("spaces.logo")} onChange={(e) => onChange(e.target.files?.[0])} />
  </div>;
}

export function GestionEspaces() {
  const vue = useEspacesStore((s) => s.fenetre);
  const id = useEspacesStore((s) => s.espaceActif);
  if (!vue) return null;
  return <FenetreEspaces key={vue === "ajouter" ? vue : `${vue}:${id}`} vue={vue} espaceId={id} />;
}
function FenetreEspaces({ vue, espaceId }: { vue: "ajouter" | "gerer"; espaceId: string | null }) {
  const { t, i18n } = useTranslation(undefined, { bindI18n: "languageChanged loaded" });
  const channels = useMatrixStore((s) => s.channels);
  const espace = channels.find((c) => c.id === espaceId && c.isSpace);
  const premier = !channels.some((c) => c.isSpace);
  const espaceConnu = !!espace;
  const adhesion = espace?.membership;
  const [onglet, setOnglet] = useState<"creer" | "rejoindre">("rejoindre");
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
  const [hierarchie, setHierarchie] = useState<espaces.SalonHierarchie[]>([]);
  const [invite, setInvite] = useState("");
  const [nomSalon, setNomSalon] = useState("");
  const [vocal, setVocal] = useState(false);
  const [commun, setCommun] = useState(true);
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
    if (import.meta.env.DEV && i18n && !i18n.exists("spaces.libraryAdminOnly")) void i18n.reloadResources().catch(() => {});
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
      void Promise.all([espaces.responsables(espaceId), espaces.membresEspace(espaceId), espaces.hierarchieEspace(espaceId), espaces.administrateurEspace(espaceId)])
        .then(([g, m, h, a]) => { if (vivant) { setGestion(g); setMembres(m); setHierarchie(h); setAdminEspace(a); setErreur(""); } })
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
    const [m, h] = await Promise.all([espaces.membresEspace(espaceId), espaces.hierarchieEspace(espaceId)]);
    setMembres(m); setHierarchie(h);
  };
  const joindre = (entree: string) => action(async () => {
    const { id, echecs } = await espaces.rejoindreEspace(entree);
    choisirEspace(id);
    if (echecs.length) setInfo(t("spaces.joinPartial", { rooms: echecs.join(", ") }));
    else useEspacesStore.getState().ouvrir(null);
  });
  const creer = () => action(async () => {
    const id = cree.current ?? await espaces.creerEspace(nom, sujet, publique);
    cree.current = id;
    // Après création, conserver l'ID même si une migration échoue : aucune deuxième équipe créée par accident.
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

  return createPortal(<div className="sion-espaces-fond" onClick={(e) => { if (e.target === e.currentTarget) fermer(); }}>
    <div className="sion-espaces-dialogue" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="titre-espaces"
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
      <header><span className="sion-espaces-entete-icone" aria-hidden="true"><UsersIcon /></span>
        <h2 id="titre-espaces">{vue === "ajouter" ? t("spaces.add") : espace?.name ?? t("spaces.title")}</h2>
        <button className="sion-espaces-fermer" type="button" ref={fermeture} disabled={occupe} aria-label={t("chat.close")} onClick={fermer}><CloseIcon /></button></header>
      {erreur && <p role="alert" className="sion-espaces-erreur">{erreur}</p>}
      {info && <p role="status">{info}</p>}
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
          <ChoixLogo image={image} onChange={setImage} />
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
        <section><h3>{t("spaces.share")}</h3><p>{t("spaces.shareHelp")}</p><input aria-label={t("spaces.share")} readOnly value={espaces.lienEspace(espaceId)} onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => void action(async () => { await navigator.clipboard.writeText(espaces.lienEspace(espaceId)); setInfo(t("spaces.copied")); })}>{t("spaces.copy")}</button></section>
        {gestion && <section><h3>{t("spaces.settings")}</h3><form onSubmit={(e) => { e.preventDefault(); void action(async () => { await espaces.modifierEspace(espaceId, nomAffiche, sujetAffiche, image); setInfo(t("spaces.saved")); }); }}>
          <label>{t("spaces.name")}<input required value={nomAffiche} onChange={(e) => { setNomModifie(true); setNom(e.target.value); }} /></label>
          <label>{t("spaces.description")}<textarea value={sujetAffiche} onChange={(e) => { setSujetModifie(true); setSujet(e.target.value); }} /></label>
          <ChoixLogo image={image} onChange={setImage} />
          <button type="submit">{t("spaces.save")}</button></form></section>}
        <section><h3>{t("spaces.rooms")}</h3><button onClick={() => void action(async () => { const echecs = await espaces.rejoindreSalonsCommuns(espaceId, false); await actualiser(); if (echecs.length) throw new Error(t("spaces.joinPartial", { rooms: echecs.join(", ") })); })}>{t("spaces.joinCommon")}</button>
          <div className="sion-espaces-liste">{enfants.map((r) => {
            const rejoint = channels.some((c) => c.id === r.room_id && c.membership !== "invite");
            const via = hierarchie.find((r) => r.room_id === espaceId)?.children_state?.find((e) => e.state_key === r.room_id)?.content.via ?? [];
            return <div className="sion-espaces-ligne" key={r.room_id}><span>{r.name ?? r.room_id}<small>{t(r.join_rule === "invite" ? "spaces.private" : "spaces.common")}</small></span>
              {!rejoint && <button onClick={() => void action(async () => { await espaces.rejoindreAvecVia(r.room_id, via); await actualiser(); })}>{t("spaces.join")}</button>}
              {gestion && <button onClick={() => void action(async () => { await espaces.retirerSalon(espaceId, r.room_id); await actualiser(); })}>{t("spaces.unlink")}</button>}
            </div>;
          })}</div>
          {gestion && <><form onSubmit={(e) => { e.preventDefault(); void action(async () => { await espaces.creerSalonDansEspace(espaceId, nomSalon, vocal, commun); setNomSalon(""); await actualiser(); }); }}>
            <label>{t("spaces.newRoom")}<input required value={nomSalon} onChange={(e) => setNomSalon(e.target.value)} /></label>
            <label className="sion-espaces-check"><CaseEspace cochee={vocal} onChange={setVocal} />{t("spaces.voice")}</label>
            <label className="sion-espaces-check"><CaseEspace cochee={commun} onChange={setCommun} />{t("spaces.commonRoom")}</label>
            <button type="submit"><PlusIcon />{t("spaces.newRoom")}</button></form>
            <form onSubmit={(e) => { e.preventDefault(); void action(async () => { const regle = await espaces.lireEtat(ajoutSalon, "m.room.join_rules"); await espaces.lierSalon(espaceId, ajoutSalon, regle?.join_rule === "public"); setAjoutSalon(""); await actualiser(); }); }}>
              <label>{t("spaces.existingRoom")}<select required value={ajoutSalon} onChange={(e) => setAjoutSalon(e.target.value)}><option value="">{t("spaces.chooseRoom")}</option>{candidats.filter((c) => !(espace?.spaceChildren ?? []).includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <button type="submit">{t("spaces.link")}</button></form></>}
        </section>
        <section><h3>{t("spaces.library")}</h3><p>{t(espace?.boardRoomId ? "spaces.libraryShared" : "spaces.noLibrary")}</p>
          {adminEspace ? <button onClick={() => void action(async () => { const resultat = await espaces.creerBibliotheque(espaceId); await actualiser(); if (resultat.echecs.length) throw new Error(t("spaces.librarySyncPartial", { count: resultat.echecs.length })); setInfo(t("spaces.saved")); })}>{t(espace?.boardRoomId ? "spaces.syncLibrary" : "spaces.createLibrary")}</button>
            : <p>{t("spaces.libraryAdminOnly")}</p>}
        </section>
        <section><h3>{t("spaces.members")}</h3><div className="sion-espaces-liste">{membres.map((m) => <div className="sion-espaces-ligne" key={m.userId}><span>{m.displayName ?? m.userId}<small>{m.userId}</small></span>
          {gestion ? <select aria-label={t("spaces.roleFor", { user: m.displayName ?? m.userId })} value={m.powerLevel >= 100 ? 100 : m.powerLevel >= 50 ? 50 : 0} disabled={!Number.isFinite(m.powerLevel)} onChange={(e) => void action(async () => { const echecs = await espaces.changerRoleEspace(espaceId, m.userId, Number(e.target.value)); await actualiser(); if (echecs.length) throw new Error(t("spaces.rolePartial", { count: echecs.length })); })}>
            <option value={0}>{t("spaces.member")}</option><option value={50}>{t("spaces.moderator")}</option><option value={100}>{t("spaces.admin")}</option></select> : <small>{t(m.powerLevel >= 100 ? "spaces.admin" : m.powerLevel >= 50 ? "spaces.moderator" : "spaces.member")}</small>}
        </div>)}</div>
          {gestion && <form onSubmit={(e) => { e.preventDefault(); void action(async () => { await inviteUser(espaceId, invite.trim()); setInvite(""); setInfo(t("spaces.invited")); }); }}><label>{t("spaces.inviteUser")}<input required pattern="@[^ ]+:.+" placeholder="@alice:example.org" value={invite} onChange={(e) => setInvite(e.target.value)} /></label><button type="submit">{t("spaces.invite")}</button></form>}
        </section>
        <section><p>{t("spaces.leaveHelp")}</p>{confirmerDepart ? <><p>{t("spaces.leaveConfirm")}</p><button onClick={() => void action(async () => { await leaveRoom(espaceId); choisirEspace(null); useEspacesStore.getState().ouvrir(null); })}>{t("spaces.leave")}</button><button onClick={() => setConfirmerDepart(false)}>{t("auth.cancel")}</button></> : <button onClick={() => setConfirmerDepart(true)}>{t("spaces.leave")}</button>}</section>
      </>}
      </fieldset>
      {occupe && <p role="status">{t("spaces.working")}</p>}
    </div>
  </div>, document.body);
}
