import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLayoutStore, PANNEAU_MIN_WIDTH, PANNEAU_MAX_WIDTH, PANNEAU_DEFAULT_WIDTH,
  PANNEAUX_BAS_MIN_HEIGHT, PANNEAUX_BAS_MAX_HEIGHT, PANNEAUX_BAS_DEFAULT_HEIGHT,
  type PanneauId, type ZonePanneau } from "../../stores/useLayoutStore";
import { PANNEAU_TITRES, PANNEAU_CORPS, PANNEAU_COMPTEURS } from "./panneaux";
import { Bulle } from "./Bulle";
import { ResizeHandle } from "./ResizeHandle";
import { CloseIcon } from "../icons";
import { useDeplacementModule } from "./useDeplacementModule";
import { LIBELLES_PLACEMENT, ordreApresPlacement, useApercuPlacementModule } from "./apercuPlacementModule";
import { ModuleEnMain } from "./ModuleEnMain";

const LIBELLES_COMPTEURS: Partial<Record<PanneauId, { cle: string; un: string; plusieurs: string }>> = {
  soundboard: { cle: "soundboard.soundCount", un: "{{count}} son", plusieurs: "{{count}} sons" },
  memeboard: { cle: "memeboard.count", un: "{{count}} mème", plusieurs: "{{count}} mèmes" },
  members: { cle: "members.count", un: "{{count}} membre", plusieurs: "{{count}} membres" },
  pinned: { cle: "chat.pinnedMessageCount", un: "{{count}} épinglé", plusieurs: "{{count}} épinglés" },
};

function Compteur({ id }: { id: PanneauId }) {
  const { t } = useTranslation();
  const useTotal = PANNEAU_COMPTEURS[id] ?? (() => null);
  const total = useTotal();
  if (total == null) return null;
  const libelle = LIBELLES_COMPTEURS[id];
  const texte = libelle ? t(libelle.cle, { count: total, defaultValue: total === 1 ? libelle.un : libelle.plusieurs }) : total;
  return <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0, color: 'var(--color-on-surface-variant)', background: 'var(--color-surface-container-high)' }}>{texte}</span>;
}

function CartePanneau({ id, zone }: { id: PanneauId; zone: ZonePanneau }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const deplacement = useDeplacementModule(id);
  useEffect(() => {
    if (useLayoutStore.getState().panneau !== id) return;
    const origine = document.activeElement as HTMLElement | null;
    const conteneur = ref.current;
    conteneur?.querySelector<HTMLButtonElement>('button[data-fermer-panneau]')?.focus();
    return () => {
      if (origine?.isConnected && (!document.activeElement || document.activeElement === document.body || conteneur?.contains(document.activeElement))) origine.focus();
    };
  }, [id]);
  const fermer = () => useLayoutStore.getState().fermerPanneau(id);
  const Corps = PANNEAU_CORPS[id];
  return <div ref={ref} className="sion-carte-panneau" data-panneau={id}
    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } }}>
    <Bulle as="aside" scope={id} aria-label={t(PANNEAU_TITRES[id])} style={{ height: '100%', width: '100%' }}>
      <div className="sion-panneau-entete">
        <div className="sion-panneau-titre" title={t("layout.dragPanel", { defaultValue: "Glisser pour déplacer le module" })} {...deplacement}>
          <span aria-hidden className="sion-poignee-module">⠿</span><span>{t(PANNEAU_TITRES[id])}</span>
        </div>
        <Compteur id={id} />
        <select className="sion-position-module" value={zone}
          aria-label={t("layout.panelPosition", { defaultValue: "Position de {{name}}", name: t(PANNEAU_TITRES[id]) })}
          onChange={(e) => {
            const valeur = e.currentTarget.value, s = useLayoutStore.getState();
            if (valeur === "up" || valeur === "down") s.ordonnerPanneau(id, valeur === "up" ? -1 : 1);
            else s.deplacerPanneau(id, valeur as ZonePanneau);
            e.currentTarget.value = zone;
          }}>
          <option value="left">{t("layout.panelLeft", { defaultValue: "À gauche" })}</option>
          <option value="right">{t("layout.panelRight", { defaultValue: "À droite" })}</option>
          <option value="top">{t("layout.zoneTop")}</option>
          <option value="bottom">{t("layout.panelBottom", { defaultValue: "En bas" })}</option>
          <optgroup label={t("layout.panelOrder", { defaultValue: "Ordre" })}>
            <option value="up">{t("layout.panelEarlier", { defaultValue: "Avant" })}</option>
            <option value="down">{t("layout.panelLater", { defaultValue: "Après" })}</option>
          </optgroup>
        </select>
        <button type="button" data-fermer-panneau aria-label={t("chat.close")} title={t("chat.close")} onClick={fermer}><CloseIcon /></button>
      </div>
      <Suspense fallback={<div style={{ padding: 16, fontSize: 12 }}>{t("chat.loading")}</div>}><Corps /></Suspense>
    </Bulle>
  </div>;
}

/** Plusieurs bulles empilées sur les côtés, côte à côte en haut et en bas. */
export function PanneauLateral({ zone = "right" }: { zone?: ZonePanneau }) {
  const { t } = useTranslation();
  const panneaux = useLayoutStore((s) => s.panneaux);
  const positions = useLayoutStore((s) => s.positionsPanneaux);
  const taille = useLayoutStore((s) => zone === "top" ? s.hauteurPanneauxHaut : zone === "bottom" ? s.hauteurPanneauxBas : zone === "left" ? s.largeurPanneauGauche : s.largeurPanneau);
  const visibles = panneaux.filter((id) => (positions[id] ?? "right") === zone);
  if (!visibles.length) return null;
  const horizontal = zone === "bottom" || zone === "top";
  const setTaille = (px: number) => useLayoutStore.getState().setLargeurPanneau(px, zone);
  return <div className={`sion-panneau sion-panneau--${zone}`} data-zone-panneaux={zone}
    style={horizontal ? { height: taille } : { width: taille }}>
    <ResizeHandle side={zone === "top" ? "bottom" : zone === "bottom" ? "top" : zone === "left" ? "right" : "left"} value={taille}
      min={horizontal ? PANNEAUX_BAS_MIN_HEIGHT : PANNEAU_MIN_WIDTH} max={horizontal ? PANNEAUX_BAS_MAX_HEIGHT : PANNEAU_MAX_WIDTH}
      onChange={setTaille} onReset={() => setTaille(horizontal ? PANNEAUX_BAS_DEFAULT_HEIGHT : PANNEAU_DEFAULT_WIDTH)} label={t("layout.resizePanel")} />
    <div className="sion-zone-panneaux">{visibles.map((id) => <CartePanneau key={id} id={id} zone={zone} />)}</div>
  </div>;
}

/** Un seul aperçu, mesuré dans le même layout que les modules après dépôt. */
export function CiblesModules() {
  const { t } = useTranslation();
  const deplacement = useLayoutStore((s) => s.panneauEnDeplacement);
  const cible = useApercuPlacementModule((s) => s.cible);
  const panneaux = useLayoutStore((s) => s.panneaux);
  const positions = useLayoutStore((s) => s.positionsPanneaux);
  const gauche = useLayoutStore((s) => s.largeurPanneauGauche);
  const droite = useLayoutStore((s) => s.largeurPanneau);
  const hauteurBas = useLayoutStore((s) => s.hauteurPanneauxBas);
  const hauteurHaut = useLayoutStore((s) => s.hauteurPanneauxHaut);
  const ref = useRef<HTMLDivElement>(null);
  const apercu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const calque = ref.current, bulle = apercu.current;
    const racine = calque?.parentElement;
    if (!calque || !bulle || !racine || !deplacement) return;
    const mesurer = () => {
      for (const zone of ["left", "right", "top", "bottom"]) {
        const origine = racine.querySelector<HTMLElement>(`[data-zone-panneaux="${zone}"] .sion-zone-panneaux`);
        const miroir = calque.querySelector<HTMLElement>(`[data-apercu-colonne="${zone}"] .sion-zone-panneaux`);
        if (miroir && origine) { miroir.scrollTop = origine.scrollTop; miroir.scrollLeft = origine.scrollLeft; }
      }
      const place = calque.querySelector<HTMLElement>(`[data-apercu-emplacement="${deplacement}"]`);
      if (!place) return;
      const r = place.getBoundingClientRect(), cadre = calque.getBoundingClientRect();
      Object.assign(bulle.style, { left: `${r.left - cadre.left}px`, top: `${r.top - cadre.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(calque);
    racine.addEventListener("scroll", mesurer, true);
    return () => { observateur.disconnect(); racine.removeEventListener("scroll", mesurer, true); };
  }, [deplacement, cible, panneaux, positions, gauche, droite, hauteurBas, hauteurHaut]);

  if (!deplacement || !cible) return <ModuleEnMain />;
  const ordre = ordreApresPlacement(panneaux, deplacement, cible);
  const ids = (zone: ZonePanneau) => ordre.filter((id) => (id === deplacement ? cible.zone : positions[id] ?? "right") === zone);
  const colonne = (zone: ZonePanneau) => {
    const modules = ids(zone);
    if (!modules.length) return null;
    return <div className={`sion-panneau sion-panneau--${zone}`} data-apercu-colonne={zone}
      style={zone === "top" ? { height: hauteurHaut } : zone === "bottom" ? { height: hauteurBas } : { width: zone === "left" ? gauche : droite }}>
      <div className="sion-zone-panneaux">{modules.map((id) => <div key={id} className="sion-carte-panneau" data-apercu-emplacement={id} />)}</div>
    </div>;
  };
  return <><ModuleEnMain /><div className="sion-apercu-deplacement" ref={ref} aria-hidden="true">
    <div className="sion-apercu-implantation">
      {colonne("top")}
      <div className={`sion-conversation-et-panneaux${ids("left").length && ids("right").length ? " sion-panneaux-deux-cotes" : ""}`}>
        {colonne("left")}<div style={{ flex: 1, minWidth: 0 }} />{colonne("right")}
      </div>
      {colonne("bottom")}
    </div>
    {/* Seul le rectangle visible est un calque au-dessus des vidéos natives. */}
    <div className="sion-apercu-module" ref={apercu} data-apercu-module={deplacement} data-apercu-zone={cible.zone} style={{ position: "absolute" }}>
      <div className="sion-panneau-entete"><span aria-hidden="true" className="sion-poignee-module">⠿</span><span className="sion-panneau-titre">{t(PANNEAU_TITRES[deplacement])}</span></div>
      <div className="sion-apercu-destination"><strong>{t(LIBELLES_PLACEMENT[cible.zone])}</strong><span>{t("layout.dropPanelHere", { defaultValue: "Relâche pour placer" })}</span></div>
    </div>
  </div></>;
}
