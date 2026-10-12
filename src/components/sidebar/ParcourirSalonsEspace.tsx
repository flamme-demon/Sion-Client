import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { choisirEspace } from "../../hooks/useEspaces";
import { decouvrirSalonsEspace, rejoindreAvecVia, type SalonDecouvrable } from "../../services/espacesService";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { CloseIcon, HashIcon, UsersIcon } from "../icons";
import "./GestionEspaces.css";
import "./ParcourirSalonsEspace.css";

export function ParcourirSalonsEspace({ espaceId }: { espaceId: string }) {
  const { t, i18n } = useTranslation(undefined, { bindI18n: "languageChanged loaded" });
  const channels = useMatrixStore((s) => s.channels);
  const utilisateur = useMatrixStore((s) => s.currentUserId);
  const espace = channels.find((c) => c.id === espaceId);
  const [chemin, setChemin] = useState([{ id: espaceId, nom: espace?.name ?? t("spaces.title") }]);
  const niveau = chemin.at(-1)!;
  const [salons, setSalons] = useState<SalonDecouvrable[]>([]);
  const [selection, setSelection] = useState<Record<string, SalonDecouvrable>>({});
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(true);
  const [revision, setRevision] = useState(0);
  const [erreur, setErreur] = useState("");
  const [erreurLecture, setErreurLecture] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const enCours = useRef(false);
  const monte = useRef(true);
  const dialogue = useRef<HTMLDivElement>(null);
  const fermerBouton = useRef<HTMLButtonElement>(null);
  const fermer = () => { if (!enCours.current) useEspacesStore.getState().ouvrir(null); };
  const rejoint = (id: string) => channels.some((c) => c.id === id && c.membership !== "invite");

  useEffect(() => {
    if (import.meta.env.DEV && i18n && !i18n.exists("spaces.chooseRooms")) void i18n.reloadResources().catch(() => {});
  }, [i18n]);

  useEffect(() => {
    monte.current = true;
    const origine = document.activeElement as HTMLElement | null;
    fermerBouton.current?.focus();
    return () => { monte.current = false; if (origine?.isConnected) origine.focus(); };
  }, []);
  useEffect(() => {
    let actif = true;
    void decouvrirSalonsEspace(niveau.id).then((liste) => {
      if (actif) setSalons(liste);
    }).catch((e) => {
      if (actif) { setErreur(e instanceof Error ? e.message : String(e)); setErreurLecture(true); }
    }).finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [niveau.id, utilisateur, revision]);

  const reinitialiserLecture = () => { setChargement(true); setErreur(""); setErreurLecture(false); setSalons([]); };
  const naviguer = (suite: typeof chemin) => {
    if (suite.at(-1)?.id === niveau.id) return;
    reinitialiserLecture(); setRecherche(""); setChemin(suite);
  };
  const terme = recherche.trim().toLocaleLowerCase();
  const visibles = salons.filter((r) => `${r.name ?? r.room_id} ${r.topic ?? ""}`.toLocaleLowerCase().includes(terme))
    .sort((a, b) => Number(b.room_type === "m.space") - Number(a.room_type === "m.space")
      || Number(b.suggested) - Number(a.suggested) || (a.name ?? a.room_id).localeCompare(b.name ?? b.room_id));
  const choisis = Object.values(selection).filter((r) => !rejoint(r.room_id));
  const joindre = async () => {
    if (enCours.current || !choisis.length) return;
    enCours.current = true; setOccupe(true); setErreur(""); setErreurLecture(false);
    const restants: Record<string, SalonDecouvrable> = {};
    const erreurs: string[] = [];
    for (const r of choisis) {
      if (useMatrixStore.getState().currentUserId !== utilisateur) break;
      try { await rejoindreAvecVia(r.room_id, r.via); }
      catch (e) { restants[r.room_id] = r; erreurs.push(`${r.name ?? r.room_id} : ${e instanceof Error ? e.message : String(e)}`); }
    }
    enCours.current = false;
    if (!monte.current || useMatrixStore.getState().currentUserId !== utilisateur) return;
    setOccupe(false); setSelection(restants);
    if (erreurs.length) setErreur(erreurs.join("\n"));
    else { choisirEspace(espaceId); useEspacesStore.getState().ouvrir(null); }
  };

  return createPortal(<div className="sion-espaces-fond" onClick={(e) => { if (e.target === e.currentTarget) fermer(); }}>
    <div className="sion-espaces-dialogue sion-decouverte-dialogue" ref={dialogue} role="dialog" aria-modal="true" aria-labelledby="titre-decouverte"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); fermer(); }
        if (e.key === "Tab") {
          const elements = Array.from(dialogue.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []).filter((v) => v.getClientRects().length > 0);
          if (e.shiftKey && document.activeElement === elements[0]) { e.preventDefault(); elements.at(-1)?.focus(); }
          else if (!e.shiftKey && document.activeElement === elements.at(-1)) { e.preventDefault(); elements[0]?.focus(); }
        }
      }}>
      <header><span className="sion-espaces-entete-icone" aria-hidden="true">{espace?.icon ? <img src={espace.icon} alt="" /> : <UsersIcon />}</span>
        <div className="sion-decouverte-titre"><h2 id="titre-decouverte">{t("spaces.chooseRooms")}</h2><small>{espace?.name ?? niveau.nom}</small></div>
        <button className="sion-espaces-fermer" ref={fermerBouton} type="button" disabled={occupe} aria-label={t("chat.close")} onClick={fermer}><CloseIcon /></button></header>
      <p>{t("spaces.chooseRoomsHelp")}</p>
      <fieldset disabled={occupe}>
        {chemin.length > 1 && <nav className="sion-decouverte-chemin" aria-label={t("spaces.subspaces")}>
          {chemin.map((etape, i) => <button type="button" key={etape.id} aria-current={i === chemin.length - 1 ? "location" : undefined}
            onClick={() => naviguer(chemin.slice(0, i + 1))}>{i === 0 ? espace?.name ?? etape.nom : etape.nom}</button>)}
        </nav>}
        <label className="sion-decouverte-recherche">{t("spaces.searchRooms")}<input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={t("spaces.searchRoomsPlaceholder")} /></label>
        {erreur && <div role="alert" className="sion-decouverte-erreur"><p className="sion-espaces-erreur">{erreur}</p>
          {erreurLecture && <button type="button" onClick={() => { reinitialiserLecture(); setRevision((r) => r + 1); }}>{t("spaces.retryRooms")}</button>}</div>}
        <div className="sion-decouverte-liste" aria-busy={chargement}>
          {chargement ? <p role="status">{t("spaces.loadingRooms")}</p> : visibles.map((r) => {
            const sousEspace = r.room_type === "m.space";
            const avatar = <span className="sion-decouverte-avatar" aria-hidden="true">{r.icon ? <img src={r.icon} alt="" loading="lazy" /> : sousEspace ? <UsersIcon /> : <HashIcon />}</span>;
            const contenu = <span className="sion-decouverte-nom"><strong>{r.name ?? r.room_id}</strong>{r.topic && <small title={r.topic}>{r.topic}</small>}</span>;
            if (sousEspace) return <button className="sion-decouverte-sous-espace" data-decouverte-espace={r.room_id} type="button" key={r.room_id}
              disabled={chemin.some((v) => v.id === r.room_id)} onClick={() => naviguer([...chemin, { id: r.room_id, nom: r.name ?? r.room_id }])}>
              {avatar}{contenu}<small>{t("spaces.openSubspace")} ›</small></button>;
            const deja = rejoint(r.room_id);
            return <label className={`sion-decouverte-salon${deja ? " sion-decouverte-salon--rejoint" : ""}`} key={r.room_id} data-decouverte-salon={r.room_id}>
              <span className="sion-espaces-case"><input type="checkbox" aria-label={r.name ?? r.room_id} checked={deja || !!selection[r.room_id]} disabled={deja}
                onChange={(e) => setSelection((avant) => { const apres = { ...avant }; if (e.target.checked) apres[r.room_id] = r; else delete apres[r.room_id]; return apres; })} />
                <span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 10 8 14 16 6" /></svg></span></span>
              {avatar}{contenu}{deja ? <small>{t("spaces.alreadyJoined")}</small> : r.suggested && <small>{t("spaces.suggestedRoom")}</small>}
            </label>;
          })}
          {!chargement && !erreur && !visibles.length && <p>{t(terme ? "spaces.noMatchingRooms" : "spaces.noRooms")}</p>}
        </div>
        <footer className="sion-decouverte-actions"><span aria-live="polite">{t("spaces.selectedRooms", { count: choisis.length })}</span>
          <div className="sion-espaces-actions"><button type="button" className="sion-espaces-annuler" onClick={fermer}>{t("spaces.browseDone")}</button>
            <button type="button" className="sion-espaces-primaire" disabled={chargement || !choisis.length} onClick={() => void joindre()}>{t(occupe ? "spaces.joiningRooms" : "spaces.joinSelectedRooms")}</button></div></footer>
      </fieldset>
    </div>
  </div>, document.body);
}
