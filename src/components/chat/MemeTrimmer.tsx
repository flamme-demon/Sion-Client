// Découpe des mèmes : vue d'ensemble, zoom et curseur de lecture.
// Les images et la lecture utilisent ffmpeg et le lecteur natif du fil.
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { blobPrepare, imageMeme, MEME_DUREE_MAX_MS } from "../../services/memeboardService";
import { definirLecteurActif, libererLecteurActif, useEstLecteurActif } from "../../services/lecteurActif";
import { etatLecteurVideo, pauseLecteurVideo, type EtatLecteurVideo } from "../../services/voiceNativeService";
import { PisteMeme, type GlissementMeme, type RegionMeme } from "./PisteMeme";

const NativeVideoPlayer = lazy(() => import("./NativeVideoPlayer").then((m) => ({ default: m.NativeVideoPlayer })));

interface Props {
  source: string;
  dureeMs: number;
  onChange: (debutMs: number, finMs: number) => void;
  essai: string | null;
  onFinEssai: () => void;
  onTesterSelection?: () => void;
  occupe?: boolean;
}

const HAUTEUR_ZONE = 240;
const DUREE_MIN_MS = 500;
const MARGE_ZOOM_MS = 2_000;
const LIBELLES_EDITEUR = {
  editorOverview: "Vue d’ensemble — clique pour positionner, glisse la sélection",
  editorZoom: "Vue zoomée",
  editorZoomIn: "Zoomer",
  editorZoomOut: "Dézoomer",
  editorCenter: "Recentrer",
  editorHint: "Clique dans le zoom pour placer le curseur, lis ou mets en pause, puis fixe le début ou la fin. Tu peux aussi glisser les bords.",
  editorPlayCursor: "Lire (curseur)",
  editorPlaySelection: "Sélection",
  editorFixStart: "Fixer le début",
  editorFixEnd: "Fixer la fin",
  editorFixHint: "Caler cette borne sur le curseur ; Alt + flèches ajuste les poignées à la milliseconde.",
};
const borner = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

function temps(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const secondes = Math.floor(total / 1000);
  return `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

function fenetreAutour(centre: number, largeur: number, duree: number): RegionMeme {
  const taille = Math.min(duree, Math.max(250, largeur));
  const debut = Math.round(borner(centre - taille / 2, 0, Math.max(0, duree - taille)));
  return { debut, fin: debut + taille };
}

interface Geste {
  mode: GlissementMeme | "curseur";
  x: number;
  region: RegionMeme;
  curseur: number;
  msParPixel: number;
  suivreZoom: boolean;
  largeurZoom: number;
}

export function MemeTrimmer({ source, dureeMs, onChange, essai, onFinEssai, onTesterSelection, occupe = false }: Props) {
  const { t } = useTranslation();
  const libelle = (cle: keyof typeof LIBELLES_EDITEUR) => t(`memeboard.${cle}`, { defaultValue: LIBELLES_EDITEUR[cle] });
  const duree = Math.max(1, dureeMs);
  const minimum = Math.min(DUREE_MIN_MS, duree);
  const maximum = Math.min(MEME_DUREE_MAX_MS, duree);
  const [region, setRegion] = useState<RegionMeme>({ debut: 0, fin: maximum });
  const regionRef = useRef(region);
  const [zoom, setZoom] = useState(() => fenetreAutour(maximum / 2, maximum + 2 * MARGE_ZOOM_MS, duree));
  const [curseur, setCurseur] = useState<number | null>(null);
  const curseurRef = useRef<number | null>(null);
  const [apercu, setApercu] = useState<{ debut: number; fin?: number }>({ debut: 0 });
  const [image, setImage] = useState<string | null>(null);
  const imageRef = useRef<string | null>(null);
  const glisse = useRef<Geste | null>(null);
  const [lecture, setLecture] = useState<{ depart: number; numero: number } | null>(null);
  const numeroLecture = useRef(0);
  const [enPause, setEnPause] = useState(false);
  const idLecture = useId();
  const lecteurActif = useEstLecteurActif(idLecture);
  const lectureSource = lecture !== null && lecteurActif && !essai;
  const enLecture = !!essai || lectureSource;
  const onChangeRef = useRef(onChange);
  const onFinEssaiRef = useRef(onFinEssai);
  const essaiRef = useRef(essai);
  useEffect(() => {
    onChangeRef.current = onChange;
    onFinEssaiRef.current = onFinEssai;
    essaiRef.current = essai;
  });
  useEffect(() => () => libererLecteurActif(idLecture), [idLecture]);

  const retenirCurseur = useCallback((ms: number) => {
    const point = Math.round(borner(ms, 0, duree));
    curseurRef.current = point;
    setCurseur(point);
    return point;
  }, [duree]);

  const stopper = useCallback(() => {
    if (essaiRef.current) onFinEssaiRef.current();
    libererLecteurActif(idLecture);
    setLecture(null);
    setEnPause(false);
  }, [idLecture]);

  const placerCurseur = useCallback((ms: number) => {
    stopper();
    const point = retenirCurseur(ms);
    setApercu(point >= duree
      ? { debut: Math.max(0, duree - 1000), fin: duree }
      : { debut: point });
  }, [duree, retenirCurseur, stopper]);

  const commettre = useCallback((suivant: RegionMeme, borne: "debut" | "fin" = "debut") => {
    stopper();
    const r = { debut: Math.round(suivant.debut), fin: Math.round(suivant.fin) };
    const precedent = regionRef.current;
    regionRef.current = r;
    setRegion(r);
    retenirCurseur(r[borne]);
    setApercu(borne === "fin" ? { debut: r.debut, fin: r.fin } : { debut: r.debut });
    if (r.debut !== precedent.debut || r.fin !== precedent.fin) onChangeRef.current(r.debut, r.fin);
  }, [retenirCurseur, stopper]);

  // Une seule image après le geste ; aucune extraction pendant la lecture.
  useEffect(() => {
    if (enLecture) return;
    let vivant = true;
    const minuterie = window.setTimeout(() => {
      void imageMeme(source, apercu.debut, apercu.fin)
        .then((chemin) => blobPrepare(chemin, "image/jpeg"))
        .then((blob) => {
          if (!vivant) return;
          const url = URL.createObjectURL(blob);
          if (imageRef.current) URL.revokeObjectURL(imageRef.current);
          imageRef.current = url;
          setImage(url);
        }).catch(() => { /* instant sans image */ });
    }, 120);
    return () => { vivant = false; window.clearTimeout(minuterie); };
  }, [source, apercu.debut, apercu.fin, enLecture]);
  useEffect(() => () => { if (imageRef.current) URL.revokeObjectURL(imageRef.current); }, []);

  const centrerSelection = (r = regionRef.current) => setZoom(fenetreAutour(
    (r.debut + r.fin) / 2, r.fin - r.debut + 2 * MARGE_ZOOM_MS, duree,
  ));

  const saisir = (e: React.PointerEvent, mode: GlissementMeme, msParPixel: number, suivreZoom: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    stopper();
    const r = regionRef.current;
    glisse.current = { mode, x: e.clientX, region: { ...r }, curseur: curseurRef.current ?? r.debut, msParPixel, suivreZoom, largeurZoom: zoom.fin - zoom.debut };
    if (mode !== "selection") {
      retenirCurseur(r[mode]);
      setApercu(mode === "fin" ? { debut: r.debut, fin: r.fin } : { debut: r.debut });
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const positionnerSelection = (e: React.PointerEvent, instant: number, msParPixel: number) => {
    e.preventDefault();
    const r = regionRef.current;
    const longueur = r.fin - r.debut;
    const debut = borner(instant - longueur / 2, 0, duree - longueur);
    const suivant = { debut, fin: debut + longueur };
    commettre(suivant);
    centrerSelection(suivant);
    glisse.current = { mode: "selection", x: e.clientX, region: suivant, curseur: debut, msParPixel, suivreZoom: true, largeurZoom: zoom.fin - zoom.debut };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const viser = (e: React.PointerEvent, instant: number, msParPixel: number) => {
    e.preventDefault();
    placerCurseur(instant);
    glisse.current = { mode: "curseur", x: e.clientX, region: { ...regionRef.current }, curseur: instant, msParPixel, suivreZoom: false, largeurZoom: zoom.fin - zoom.debut };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const bouger = (e: PointerEvent) => {
      const geste = glisse.current;
      if (!geste || occupe) return;
      const delta = (e.clientX - geste.x) * geste.msParPixel;
      const r = geste.region;
      if (geste.mode === "curseur") { placerCurseur(geste.curseur + delta); return; }
      let suivant: RegionMeme;
      if (geste.mode === "selection") {
        const debut = borner(r.debut + delta, 0, duree - (r.fin - r.debut));
        suivant = { debut, fin: debut + r.fin - r.debut };
      } else if (geste.mode === "debut") {
        suivant = { debut: borner(r.debut + delta, Math.max(0, r.fin - maximum), r.fin - minimum), fin: r.fin };
      } else {
        suivant = { debut: r.debut, fin: borner(r.fin + delta, r.debut + minimum, Math.min(duree, r.debut + maximum)) };
      }
      commettre(suivant, geste.mode === "fin" ? "fin" : "debut");
      if (geste.suivreZoom) setZoom(fenetreAutour((suivant.debut + suivant.fin) / 2, geste.largeurZoom, duree));
    };
    const relacher = () => { glisse.current = null; };
    const terminer = (e: PointerEvent) => { bouger(e); relacher(); };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", terminer);
    window.addEventListener("pointercancel", relacher);
    window.addEventListener("blur", relacher);
    return () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", terminer);
      window.removeEventListener("pointercancel", relacher);
      window.removeEventListener("blur", relacher);
    };
  }, [duree, minimum, maximum, occupe, commettre, placerCurseur]);

  const toucheBorne = (borne: "debut" | "fin", e: React.KeyboardEvent) => {
    if (occupe || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const r = regionRef.current;
    const pas = e.altKey ? 1 : e.shiftKey ? 100 : 10;
    const min = borne === "debut" ? Math.max(0, r.fin - maximum) : r.debut + minimum;
    const max = borne === "debut" ? r.fin - minimum : Math.min(duree, r.debut + maximum);
    const cible = e.key === "Home" ? min : e.key === "End" ? max : r[borne] + (e.key === "ArrowRight" ? pas : -pas);
    commettre({ ...r, [borne]: borner(cible, min, max) }, borne);
  };

  const suivreLecture = useCallback((etat: EtatLecteurVideo) => {
    if (!etat.actif) return;
    const point = retenirCurseur(etat.position_ms + (essaiRef.current ? regionRef.current.debut : 0));
    setApercu(point >= duree ? { debut: Math.max(0, duree - 1000), fin: duree } : { debut: point });
    setEnPause(etat.en_pause);
  }, [duree, retenirCurseur]);

  const lireCurseur = async () => {
    if (enLecture) {
      try { suivreLecture(await pauseLecteurVideo(!enPause)); } catch { /* lecteur terminé */ }
      return;
    }
    stopper();
    definirLecteurActif(idLecture);
    setLecture({ depart: Math.min(curseurRef.current ?? regionRef.current.debut, duree - 1), numero: ++numeroLecture.current });
  };

  const fixer = async (borne: "debut" | "fin") => {
    let point = curseurRef.current;
    if (point === null) return;
    // Lire la position au clic : le rafraîchissement visuel à 250 ms ne doit
    // pas diminuer la précision de la coupe après une pause.
    if (enLecture) {
      try {
        const etat = await etatLecteurVideo();
        if (etat.actif) point = etat.position_ms + (essaiRef.current ? regionRef.current.debut : 0);
      } catch { /* garder le dernier curseur connu */ }
    }
    let { debut, fin } = regionRef.current;
    if (borne === "debut") {
      debut = borner(point, 0, duree - minimum);
      if (fin < debut + minimum) fin = Math.min(duree, debut + maximum);
      if (fin - debut > maximum) fin = debut + maximum;
    } else {
      fin = borner(point, minimum, duree);
      if (debut > fin - minimum) debut = Math.max(0, fin - maximum);
      if (fin - debut > maximum) debut = fin - maximum;
    }
    commettre({ debut, fin }, borne);
    centrerSelection({ debut, fin });
  };

  const modifierZoom = (facteur: number) => {
    const centre = curseur !== null && curseur >= zoom.debut && curseur <= zoom.fin ? curseur : (zoom.debut + zoom.fin) / 2;
    setZoom(fenetreAutour(centre, (zoom.fin - zoom.debut) * facteur, duree));
  };
  const bouton = (principal = false): React.CSSProperties => ({
    flex: 1, padding: "6px 12px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
    background: principal ? "var(--color-primary)" : "var(--color-surface-container-highest)",
    color: principal ? "var(--color-on-primary)" : "var(--color-on-surface)",
  });
  const peutFixer = curseur !== null && !occupe;
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ position: "relative", height: HAUTEUR_ZONE, flexShrink: 0, borderRadius: 10, overflow: "hidden", background: "var(--color-surface-container-lowest)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {enLecture ? <Suspense fallback={null}>
        <NativeVideoPlayer key={essai ? `selection:${essai}` : `curseur:${lecture!.numero}`}
          source={essai ?? source} departMs={essai ? 0 : lecture!.depart}
          onClose={stopper} onEtatChange={suivreLecture} hauteurMax={HAUTEUR_ZONE} />
      </Suspense> : image && <img src={image} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />}
    </div>
    <span style={{ fontSize: 10, color: "var(--color-outline)" }}>{libelle("editorOverview")}</span>
    <PisteMeme nom={libelle("editorOverview")} fenetre={{ debut: 0, fin: duree }} region={region} curseur={curseur} deplacerSelection desactive={occupe}
      onSaisir={(e, mode, ms) => saisir(e, mode, ms, true)} onFond={positionnerSelection} onTouche={toucheBorne} />
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ flex: 1, fontSize: 10, color: "var(--color-outline)" }}>{libelle("editorZoom")}</span>
      <button type="button" style={{ ...bouton(), flex: "none", padding: "3px 10px" }} aria-label={libelle("editorZoomOut")} disabled={zoom.fin - zoom.debut >= duree} onClick={() => modifierZoom(2)}>−</button>
      <button type="button" style={{ ...bouton(), flex: "none", padding: "3px 10px" }} aria-label={libelle("editorZoomIn")} disabled={zoom.fin - zoom.debut <= Math.min(250, duree)} onClick={() => modifierZoom(0.5)}>+</button>
      <button type="button" style={{ ...bouton(), flex: "none", padding: "3px 10px" }} onClick={() => centrerSelection()}>{libelle("editorCenter")}</button>
    </div>
    <PisteMeme nom={libelle("editorZoom")} fenetre={zoom} region={region} curseur={curseur} deplacerSelection={false} desactive={occupe}
      onSaisir={(e, mode, ms) => saisir(e, mode, ms, false)} onFond={viser} onTouche={toucheBorne} />
    <span style={{ fontSize: 10, color: "var(--color-outline)" }}>{libelle("editorHint")}</span>
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" disabled={occupe} onClick={() => void lireCurseur()} style={bouton(true)}>{enLecture && !enPause ? `⏸ ${t("chat.pause")}` : `▶ ${libelle("editorPlayCursor")}`}</button>
      {onTesterSelection && <button type="button" disabled={occupe} onClick={() => { stopper(); onTesterSelection(); }} style={bouton()}>▶ {libelle("editorPlaySelection")}</button>}
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" disabled={!peutFixer} onClick={() => void fixer("debut")} title={libelle("editorFixHint")} style={{ ...bouton(), opacity: peutFixer ? 1 : 0.4 }}>⇤ {libelle("editorFixStart")}</button>
      <button type="button" disabled={!peutFixer} onClick={() => void fixer("fin")} title={libelle("editorFixHint")} style={{ ...bouton(), opacity: peutFixer ? 1 : 0.4 }}>{libelle("editorFixEnd")} ⇥</button>
    </div>
    <div style={{ fontSize: 12, textAlign: "center", color: "var(--color-on-surface-variant)", fontVariantNumeric: "tabular-nums" }}>
      {temps(region.debut)}–{temps(region.fin)} · {((region.fin - region.debut) / 1000).toFixed(3)} s / 10 s max
      {curseur !== null && <span style={{ color: "var(--color-amber)" }}> · ● {temps(curseur)}</span>}
    </div>
  </div>;
}
