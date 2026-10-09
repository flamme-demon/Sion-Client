import { RecherchePanneau } from "./RecherchePanneau";
import { useCompteurPanneau } from "../layout/panneauxCompteurs";
import { MemeboardIcon } from "../icons";
import { ActionsCarteBoard } from "./ActionsCarteBoard";
import { ConfirmationSuppressionBoard } from "./ConfirmationSuppressionBoard";
// Memeboard : la grille des memes du salon, et leur import.
//
// Un clic fait surgir le meme par-dessus l'écran de tout le salon vocal — jeux
// compris — dans une fenêtre native (`meme_pop.rs`). Le panneau ne montre que
// des aperçus : des WebP animés, que la vue web anime sans GStreamer, là où
// une balise vidéo échouerait selon la machine.
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/useSettingsStore";
import {
  canSendMessage,
  findSoundboardRoom,
  getMatrixClient,
  getMemberPowerLevel,
  mxcToHttp,
} from "../../services/matrixService";
import { moteurRust } from "../../services/moteur";
import { useMatrixStore } from "../../stores/useMatrixStore";
import {
  analyserMeme,
  declencherMeme,
  delaiRestantMs,
  deposerSource,
  envoyerMeme,
  listMemes,
  MEME_DUREE_MAX_MS,
  modifierMeme,
  preparerMeme,
  supprimerMeme,
  type MemeAnalyse,
  type MemeEntry,
  type MemePrepare,
} from "../../services/memeboardService";
import { MemeTrimmer } from "./MemeTrimmer";
import { EmojiGridPanel } from "./EmojiGridPanel";
import { definirLecteurActif, libererLecteurActif } from "../../services/lecteurActif";
import { adresseDeReprise } from "../../services/repriseImages";
import { SUR_ANDROID } from "../../utils/plateforme";
import { buildTree, findNode, sortedChildren, parentPath, normaliserCategorie } from "../../utils/categories";
import { FiltreBoardCompact } from "./FiltreBoardCompact";
import "./BoardPanel.css";

/** Identifiant de l'essai dans le registre du lecteur unique : une vidéo du
 *  fil en cours de lecture rend la main, comme quand on en lance une autre. */
const ESSAI = "meme-essai";

const ExternalVideoImport = lazy(() =>
  import("./ExternalVideoImport").then((m) => ({ default: m.ExternalVideoImport })),
);

/** Hauteur du sélecteur d'emoji, et marge qui le sépare du bouton — les
 *  mêmes que dans l'envoi d'un son. */
const EMOJI_PANNEAU_H = 300;
const EMOJI_PANNEAU_L = 320;
const EMOJI_ECART = 8;

/** Supprimer un meme d'un autre : réservé aux modérateurs, comme ailleurs. */
const NIVEAU_MODERATION = 50;

/** Fond et carte des fenêtres d'import et d'édition. Le fond ne ferme PAS
 *  la fenêtre : un clic à côté faisait perdre la source choisie et le
 *  découpage (23/09). On ferme par « Annuler ». */
const FOND: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'var(--color-scrim, rgba(0,0,0,0.5))',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const CARTE: React.CSSProperties = {
  maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 12, padding: 20, borderRadius: 16,
  background: 'var(--color-surface-container-high)', color: 'var(--color-on-surface)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
};
const CHAMP: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10,
  border: '1px solid var(--color-outline-variant)', background: 'var(--color-surface-container)',
  color: 'var(--color-on-surface)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
};
const styleBouton = (principal: boolean, actif = true): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600,
  fontFamily: 'inherit', cursor: actif ? 'pointer' : 'not-allowed', opacity: actif ? 1 : 0.5,
  background: principal ? 'var(--color-primary)' : 'var(--color-surface-container-highest)',
  color: principal ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
});

/** Nom et emoji d'un meme, à l'import comme à l'édition. */
function ChampsNomEmoji({ nom, onNom, emoji, onEmoji }: {
  nom: string;
  onNom: (nom: string) => void;
  emoji: string;
  onEmoji: (emoji: string) => void;
}) {
  const { t } = useTranslation();
  const boutonEmoji = useRef<HTMLButtonElement>(null);
  const [selecteur, setSelecteur] = useState<{ left: number; top: number } | null>(null);

  // Même principe que l'envoi d'un son : le sélecteur est en position fixe,
  // sans quoi la fenêtre, qui défile, le rognerait. Il s'ouvre sous le
  // bouton, ou au-dessus quand la place manque.
  const placerSelecteur = useCallback(() => {
    const r = boutonEmoji.current?.getBoundingClientRect();
    if (!r) return;
    const dessous = window.innerHeight - r.bottom - EMOJI_ECART >= EMOJI_PANNEAU_H;
    setSelecteur({
      left: Math.max(EMOJI_ECART, Math.min(r.left, window.innerWidth - EMOJI_PANNEAU_L - EMOJI_ECART)),
      top: dessous ? r.bottom + EMOJI_ECART : Math.max(EMOJI_ECART, r.top - EMOJI_PANNEAU_H - EMOJI_ECART),
    });
  }, []);
  const selecteurOuvert = selecteur !== null;
  useEffect(() => {
    if (!selecteurOuvert) return;
    window.addEventListener("scroll", placerSelecteur, true);
    window.addEventListener("resize", placerSelecteur);
    return () => {
      window.removeEventListener("scroll", placerSelecteur, true);
      window.removeEventListener("resize", placerSelecteur);
    };
  }, [selecteurOuvert, placerSelecteur]);

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <label style={{ flex: 1, fontSize: 12 }}>
        {t("memeboard.name")}
        <input value={nom} maxLength={40} onChange={(e) => onNom(e.target.value)} style={CHAMP} />
      </label>
      <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column' }}>
        {t("memeboard.emoji")}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            ref={boutonEmoji}
            type="button"
            onClick={() => (selecteurOuvert ? setSelecteur(null) : placerSelecteur())}
            title={t("memeboard.emoji")}
            style={{
              width: 38, height: 36, borderRadius: 10, border: '1px solid var(--color-outline-variant)',
              background: 'var(--color-surface-container)', color: 'var(--color-on-surface)',
              fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >{emoji || '🎬'}</button>
          {emoji && (
            <button
              type="button"
              onClick={() => onEmoji("")}
              title={t("memeboard.emojiClear")}
              style={{ border: 'none', background: 'transparent', color: 'var(--color-on-surface-variant)', cursor: 'pointer', fontSize: 16, padding: 2 }}
            >×</button>
          )}
        </div>
      </div>

      {selecteur && (
        <>
          <div onClick={() => setSelecteur(null)} style={{ position: 'fixed', inset: 0, zIndex: 1001 }} />
          <div style={{
            position: 'fixed', left: selecteur.left, top: selecteur.top, width: EMOJI_PANNEAU_L, height: EMOJI_PANNEAU_H,
            zIndex: 1002, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12,
            background: 'var(--color-surface-container-high)', border: '1px solid var(--color-outline-variant)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}>
            <EmojiGridPanel emojiSize={32} onPick={(e) => { onEmoji(e); setSelecteur(null); }} />
          </div>
        </>
      )}
    </div>
  );
}

/** Édition d'un meme du salon : son nom et son emoji. La vidéo ne bouge pas,
 *  l'identifiant non plus — un `m.replace`, comme pour un son. */
function ChampCategorie({ valeur, onChange, categories }: { valeur: string; onChange: (v: string) => void; categories: string[] }) {
  const { t } = useTranslation();
  const suggestions = useId();
  return <label style={{ display: 'block', fontSize: 12 }}>
    {t("memeboard.category", { defaultValue: "Catégorie" })}
    <input value={valeur} onChange={(e) => onChange(e.target.value)} list={suggestions}
      placeholder={t("memeboard.categoryPlaceholder", { defaultValue: "Films/Kaamelott" })}
      style={{ ...CHAMP, marginTop: 4 }} />
    <datalist id={suggestions}>{categories.map((cat) => <option key={cat} value={cat} />)}</datalist>
  </label>;
}

function MemeEditModal({ meme, categories, onClose, onModifie }: { meme: MemeEntry; categories: string[]; onClose: () => void; onModifie: () => void }) {
  const { t } = useTranslation();
  const [nom, setNom] = useState(meme.label);
  const [emoji, setEmoji] = useState(meme.emoji ?? "");
  const [categorie, setCategorie] = useState(meme.category);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const change = nom.trim() !== meme.label || (emoji || null) !== meme.emoji || normaliserCategorie(categorie) !== meme.category;
  const pret = !!nom.trim() && change && !occupe;

  const enregistrer = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      await modifierMeme(meme.eventId, nom.trim(), emoji.trim() || null, normaliserCategorie(categorie));
      onModifie();
    } catch (err) {
      setErreur(`${t("memeboard.editError")} — ${String(err)}`);
      setOccupe(false);
    }
  };

  return (
    <div style={FOND}>
      <div style={{ ...CARTE, width: 420 }}>
        <div className="sion-titre" style={{ fontSize: 16, fontWeight: 700 }}>{t("memeboard.editTitle")}</div>
        <ChampsNomEmoji nom={nom} onNom={setNom} emoji={emoji} onEmoji={setEmoji} />
        <ChampCategorie valeur={categorie} onChange={setCategorie} categories={categories} />
        {erreur && <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{erreur}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={styleBouton(false)} onClick={onClose}>{t("memeboard.cancel")}</button>
          <button type="button" style={styleBouton(true, pret)} disabled={!pret} onClick={() => void enregistrer()}>
            {occupe ? t("memeboard.saving") : t("memeboard.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Aperçu d'une tuile : la première image, figée dans un canvas, et le WebP
 *  animé seulement au survol. Tous animés, les aperçus (12 images/s) faisaient
 *  redessiner la grille en permanence, tuiles hors écran comprises : 26 memes
 *  = ~1 700 dessins en 6,7 s et un cœur à moitié occupé par le pilote GPU,
 *  mesuré le 26/09. Chargement différé jusqu'à l'approche de l'écran, comme le
 *  `loading="lazy"` d'avant. */
function ApercuMeme({ src, anime }: { src: string; anime: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let annule = false;
    let image: HTMLImageElement | null = null;
    let chargement = false;
    const dessiner = (img: HTMLImageElement) => {
      const cote = Math.min(img.naturalWidth, img.naturalHeight);
      if (annule || !cote) return;
      // Recadrage « cover » au carré, comme l'<img> qu'il remplace.
      canvas.width = cote;
      canvas.height = cote;
      canvas.getContext("2d")?.drawImage(
        img, (img.naturalWidth - cote) / 2, (img.naturalHeight - cote) / 2, cote, cote, 0, 0, cote, cote,
      );
    };
    const figer = () => {
      if (image) return dessiner(image);
      if (chargement) return;
      chargement = true;
      charger(src);
    };
    const charger = (adresse: string) => {
      const img = new Image();
      img.src = adresse;
      // Détachée du document, une image animée n'avance pas : on dessine sa
      // première image. Le canvas est « teinté » (autre origine) mais s'affiche.
      img.decode().then(() => {
        image = img;
        dessiner(img);
      }).catch(() => {
        // Image du cœur Rust déjà chargée dans la page : voir repriseImages.ts.
        const reprise = adresseDeReprise(adresse);
        if (reprise && !annule) charger(reprise);
        else chargement = false;
      });
    };
    // Redessiné à CHAQUE retour à l'écran, pas seulement au premier : WebKitGTK
    // vide un canvas qu'on a masqué, et les tuiles survolées redevenaient
    // grises (26/09). L'image décodée est gardée, redessiner coûte 220 px.
    const observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) figer();
    }, { rootMargin: "200px" });
    observateur.observe(canvas);
    return () => {
      annule = true;
      observateur.disconnect();
    };
  }, [src]);

  // Le canvas n'est jamais masqué : au survol, l'aperçu animé se pose
  // par-dessus.
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {anime && (
        <img
          src={src}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </div>
  );
}

export function MemeboardPanel() {
  const { t } = useTranslation();
  const [memes, setMemes] = useState<MemeEntry[]>([]);
  const [survolee, setSurvolee] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [import_, setImport] = useState(false);
  const [aModifier, setAModifier] = useState<MemeEntry | null>(null);
  const [aSupprimer, setASupprimer] = useState<MemeEntry | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const actif = useSettingsStore((s) => s.memeboardEnabled);
  const setActif = useSettingsStore((s) => s.setMemeboardEnabled);
  const volume = useSettingsStore((s) => s.memeboardVolume);
  const setVolume = useSettingsStore((s) => s.setMemeboardVolume);
  const vue = useSettingsStore((s) => s.memeboardView);
  const setVue = useSettingsStore((s) => s.setMemeboardView);
  const compteurs = useSettingsStore((s) => s.memeboardPlayCounts);
  const incrementerLecture = useSettingsStore((s) => s.incrementMemeboardPlay);
  const categorie = useSettingsStore((s) => s.memeboardCategory);
  const setCategorie = useSettingsStore((s) => s.setMemeboardCategory);
  const rafraichirRef = useRef<() => void>(() => {});

  const annoncer = useCallback((texte: string) => {
    setMessage(texte);
    window.setTimeout(() => setMessage((m) => (m === texte ? null : m)), 4000);
  }, []);

  // Même rafraîchissement que la soundboard : sur le salon, et regroupé, sans
  // quoi un salon actif relancerait la pagination à chaque message.
  useEffect(() => {
    let annule = false;
    let minuterie: ReturnType<typeof setTimeout> | null = null;
    let salon: string | null = null;
    let chargement = false;
    let demande = false;
    const rafraichir = async () => {
      if (annule) return;
      if (chargement) { demande = true; return; }
      chargement = true;
      try {
        salon = await findSoundboardRoom();
        if (annule) return;
        setRoomId(salon);
        const liste = await listMemes();
        if (!annule) setMemes(liste);
      } catch (err) {
        if (!annule) console.warn("[Sion][memeboard] rafraîchissement impossible", err);
      } finally {
        chargement = false;
        if (demande && !annule) { demande = false; void rafraichir(); }
      }
    };
    rafraichirRef.current = () => { void rafraichir(); };
    void rafraichir();
    if (moteurRust()) {
      let arreter: (() => void) | null = null;
      void import("../../services/matrixCore").then(({ surMessages }) =>
        surMessages((fil) => {
          if (!salon || fil.salon !== salon) return;
          if (minuterie) clearTimeout(minuterie);
          minuterie = setTimeout(() => { void rafraichir(); }, 200);
        }).then((stop) => {
          if (annule) stop();
          else arreter = stop;
        }),
      );
      return () => {
        annule = true;
        if (minuterie) clearTimeout(minuterie);
        arreter?.();
      };
    }
    const client = getMatrixClient();
    if (!client) return () => { annule = true; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const surEvenement = (ev: any, room: any) => {
      const id = room?.roomId ?? ev?.getRoomId?.();
      if (!salon || id !== salon) return;
      if (minuterie) clearTimeout(minuterie);
      minuterie = setTimeout(() => { void rafraichir(); }, 200);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cl = client as any;
    cl.on("Room.timeline", surEvenement);
    cl.on("Room.redaction", surEvenement);
    return () => {
      annule = true;
      if (minuterie) clearTimeout(minuterie);
      cl.off("Room.timeline", surEvenement);
      cl.off("Room.redaction", surEvenement);
    };
  }, []);

  // Salon pas encore connu au montage (sync en cours) : on retente.
  useEffect(() => {
    if (roomId) return;
    const id = setInterval(() => rafraichirRef.current(), 2000);
    return () => clearInterval(id);
  }, [roomId]);

  // Moteur Rust : les aperçus passent par le cœur (URL sion-media), résolus
  // une fois par meme.
  const [apercusRust, setApercusRust] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!moteurRust()) return;
    const manquants = memes.map((m) => m.apercuMxc).filter((x): x is string => !!x && !(x in apercusRust));
    if (manquants.length === 0) return;
    let vivant = true;
    void import("../../services/matrixCore").then(async ({ urlMedia }) => {
      const paires = await Promise.all(manquants.map(async (mxc) => [mxc, await urlMedia(mxc).catch(() => null)] as const));
      const trouves = Object.fromEntries(paires.filter((p): p is readonly [string, string] => !!p[1]));
      if (vivant) setApercusRust((avant) => ({ ...avant, ...trouves }));
    });
    return () => { vivant = false; };
  }, [memes, apercusRust]);

  const client = getMatrixClient();
  const currentUserId = useMatrixStore((s) => s.currentUserId);
  const moi = client?.getUserId() || currentUserId || "";
  const peutEnvoyer = roomId ? canSendMessage(roomId) : false;
  const peutModerer = roomId && moi ? getMemberPowerLevel(roomId, moi) >= NIVEAU_MODERATION : false;
  // Mêmes droits que l'édition d'un son : quiconque peut écrire dans le
  // salon. Pas de nouvelle fenêtre ici, donc possible aussi sur téléphone ;
  // le cœur Rust seul sait éditer un meme.
  const peutModifier = peutEnvoyer && moteurRust();

  const categories = useMemo(() => Array.from(new Set(memes.map((m) => m.category))).sort((a, b) => a.localeCompare(b)), [memes]);
  const arbre = useMemo(() => buildTree(categories), [categories]);
  const racines = sortedChildren(arbre);
  const noeud = vue === "all" ? findNode(arbre, categorie) : null;
  const ancre = !categorie ? null : noeud && noeud.children.size > 0 ? noeud : findNode(arbre, parentPath(categorie));
  const enfants = sortedChildren(ancre);
  const montrerSousCategories = vue === "all" && ancre && ancre.name !== "" && enfants.length > 0;
  const choisirCategorie = (cat: string | null) => { setVue("all"); setCategorie(cat); };

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const correspondants = q ? memes.filter((m) => m.label.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)) : memes;
    if (vue !== "top") return correspondants.filter((m) => !categorie || m.category === categorie || m.category.startsWith(categorie + "/"));
    return correspondants
      .filter((m) => (compteurs[m.eventId] || 0) > 0)
      .sort((a, b) => (compteurs[b.eventId] || 0) - (compteurs[a.eventId] || 0) || a.label.localeCompare(b.label));
  }, [memes, recherche, vue, compteurs, categorie]);

  const lancer = async (meme: MemeEntry) => {
    if (!actif) return;
    try {
      if (!(await declencherMeme(meme))) {
        annoncer(t("memeboard.tooSoon", { s: Math.ceil(delaiRestantMs() / 1000) }));
      } else {
        incrementerLecture(meme.eventId);
      }
    } catch (err) {
      console.warn("[Sion][meme] lecture impossible", err);
      annoncer(t("memeboard.playError"));
    }
  };

  const supprimer = async (meme: MemeEntry) => {
    await supprimerMeme(meme.eventId);
    rafraichirRef.current();
  };

  const bascule = (
    <button
      type="button"
      onClick={() => setActif(!actif)}
      aria-pressed={actif}
      aria-label={actif ? t("memeboard.disable") : t("memeboard.enable")}
      title={actif ? t("memeboard.disable") : t("memeboard.enable")}
      style={{
        flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: 4,
        borderRadius: 8, display: 'flex', color: actif ? 'var(--color-on-surface)' : 'var(--color-error)',
      }}
    >
      <MemeboardIcon muted={!actif} size={18} />
    </button>
  );

  const reglageVolume = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, color: 'var(--color-on-surface-variant)' }}>
      {bascule}
      <input
        type="range" min={0} max={1} step={0.05} value={volume}
        className="sion-range"
        disabled={!actif}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        aria-label={t("memeboard.volume")}
        title={t("memeboard.volume")}
        style={{
          minWidth: 0, flex: 1,
          opacity: actif ? 1 : 0.4, cursor: actif ? 'pointer' : 'not-allowed',
          '--sion-range-progress': `${Math.round(volume * 100)}%`,
        } as React.CSSProperties}
      />
      <span style={{ minWidth: 30, textAlign: 'right', fontSize: 11, opacity: actif ? 1 : 0.4 }}>{Math.round(volume * 100)}%</span>
    </div>
  );

  useCompteurPanneau("memeboard", memes.length);

  // L'import ffmpeg reste réservé aux ordinateurs.
  const champRecherche = <RecherchePanneau valeur={recherche} onChange={setRecherche} libelle={t("memeboard.search")}
    ajout={peutEnvoyer && !SUR_ANDROID ? { libelle: t("memeboard.add"), onClick: () => setImport(true) } : undefined} />;

  const filtre = (cle: string, texte: React.ReactNode, selectionne: boolean, onClick: () => void, titre?: string) =>
    <button key={cle} type="button" data-filter={cle} aria-pressed={selectionne} onClick={onClick} title={titre}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
        padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
        border: selectionne ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
        background: selectionne ? 'var(--color-primary)' : 'transparent',
        color: selectionne ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
      }}>{texte}</button>;
  const ligneFiltres = { display: 'flex', gap: 8, padding: '0 16px 8px', flexShrink: 0, overflowX: 'auto' } as const;
  const defilerFiltres = (e: React.WheelEvent<HTMLDivElement>) => { if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY; };

  return (
    <div className="memeboard-panel sion-board" data-prete={!!roomId}>
      <div className="sion-board-outils" onWheel={defilerFiltres}>
      {roomId && (
        <div className="sion-board-recherche">
          {champRecherche}
        </div>
      )}

      {roomId && (
        <div className="sb-pills sion-board-filtres-larges" style={ligneFiltres} onWheel={defilerFiltres}>
          {filtre("top", <><span aria-hidden="true">🔥</span>{t("memeboard.top", { defaultValue: "Top" })}</>, vue === "top",
            () => { setVue("top"); setCategorie(null); }, t("memeboard.topHint", { defaultValue: "Les mèmes que tu lances le plus" }))}
          {filtre("all", t("memeboard.all", { defaultValue: "Tous" }), vue === "all" && categorie === null, () => choisirCategorie(null))}
          {racines.map((cat) => filtre(cat.fullPath, cat.name, vue === "all" && !!categorie && (categorie === cat.fullPath || categorie.startsWith(cat.fullPath + "/")), () => choisirCategorie(cat.fullPath)))}
        </div>
      )}
      {roomId && montrerSousCategories && <div className="sb-pills sion-board-filtres-larges" style={ligneFiltres} onWheel={defilerFiltres}>
        {filtre("back", "‹", false, () => choisirCategorie(parentPath(ancre.fullPath)), t("soundboard.back", { defaultValue: "Retour" }))}
        {filtre("category-all", t("memeboard.allOf", { defaultValue: "Tout {{name}}", name: ancre.name }), categorie === ancre.fullPath, () => choisirCategorie(ancre.fullPath))}
        {enfants.map((cat) => filtre(cat.fullPath, cat.name, categorie === cat.fullPath, () => choisirCategorie(cat.fullPath)))}
      </div>}
      {roomId && <FiltreBoardCompact arbre={arbre} mode={vue} categorie={categorie}
        toutes={t("memeboard.all")} libelle={t("memeboard.category")}
        onChange={(mode, cat) => { setVue(mode); setCategorie(cat); }} />}
      </div>

      {message && (
        <div className="sion-board-message">
          {message}
        </div>
      )}

      {!roomId ? (
        <div className="sion-board-vide" style={{ padding: 20, fontSize: 12, color: 'var(--color-outline)', textAlign: 'center' }}>{t("memeboard.noRoom")}</div>
      ) : visibles.length === 0 ? (
        <div className="sion-board-vide" style={{ padding: 20, fontSize: 12, color: 'var(--color-outline)', textAlign: 'center' }}>
          {memes.length === 0 ? t("memeboard.empty")
            : vue === "top" && !recherche.trim()
              ? t("memeboard.noTop", { defaultValue: "Ton TOP se remplira avec les mèmes que tu lances." })
              : t("memeboard.noMatch")}
        </div>
      ) : (
        <div className="sion-board-contenu memeboard-grid" onWheel={(e) => {
          if (getComputedStyle(e.currentTarget).overflowY === "hidden") defilerFiltres(e);
        }}>
          {visibles.map((m) => {
            const apercu = m.apercuMxc ? (moteurRust() ? (apercusRust[m.apercuMxc] ?? null) : mxcToHttp(m.apercuMxc)) : null;
            const peutSupprimer = m.senderId === moi || peutModerer;
            return (
              <div
                key={m.eventId}
                className="meme-tuile sion-carte-board"
                onClick={() => void lancer(m)}
                title={actif ? m.label : t("memeboard.disabledHint")}
                style={{
                  position: 'relative', cursor: actif ? 'pointer' : 'not-allowed',
                  border: 'none', background: 'var(--sion-fond-carte-board)',
                  opacity: actif ? 1 : 0.45, transition: 'background 120ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-surface-container-high)';
                  setSurvolee(m.eventId);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--sion-fond-carte-board)';
                  setSurvolee((id) => (id === m.eventId ? null : id));
                }}
              >
                <div className="sion-board-visuel">
                  {apercu
                    ? <ApercuMeme src={apercu} anime={survolee === m.eventId} />
                    : (m.emoji || '🎬')}
                </div>
                <div className="sion-board-description">
                <div className="sion-carte-board-nom">
                  {m.emoji ? `${m.emoji} ` : ''}{m.label}
                </div>
                <div className="meme-categorie sion-carte-board-categorie">
                  {m.category.replace(/\//g, " · ")}
                </div>
                </div>
                <ActionsCarteBoard
                  modifier={peutModifier ? { libelle: t("memeboard.edit"), onClick: () => setAModifier(m) } : undefined}
                  supprimer={peutSupprimer ? { libelle: t("memeboard.delete"), onClick: () => setASupprimer(m) } : undefined}
                />
              </div>
            );
          })}
        </div>
      )}

      {roomId && (
        <div className="sion-pied-panneau" style={{
          padding: '8px 16px', marginTop: 'auto', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-on-surface-variant)',
        }}>
          {reglageVolume}
        </div>
      )}

      {aSupprimer && (
        <ConfirmationSuppressionBoard
          titre={t("memeboard.deleteTitle", { defaultValue: "Supprimer ce mème ?" })}
          description={t("memeboard.deleteConfirm", { label: aSupprimer.label })}
          messageErreur={t("memeboard.deleteError")}
          onConfirmer={() => supprimer(aSupprimer)}
          onFermer={() => setASupprimer(null)}
        />
      )}

      {import_ && (
        <MemeImportModal
          categories={categories} categorieInitiale={categorie ?? "Autre"}
          onClose={() => setImport(false)}
          onEnvoye={() => { setImport(false); rafraichirRef.current(); }}
        />
      )}
      {aModifier && (
        <MemeEditModal
          meme={aModifier}
          categories={categories}
          onClose={() => setAModifier(null)}
          onModifie={() => { setAModifier(null); rafraichirRef.current(); }}
        />
      )}
    </div>
  );
}

/** Import d'un meme : une source, l'extrait choisi à l'œil et à l'oreille, un
 *  essai sur son propre écran, puis l'envoi. */
function MemeImportModal({ categories, categorieInitiale, onClose, onEnvoye }: { categories: string[]; categorieInitiale: string; onClose: () => void; onEnvoye: () => void }) {
  const { t } = useTranslation();
  const [fichier, setFichier] = useState<File | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState<MemeAnalyse | null>(null);
  const [lien, setLien] = useState(false);
  const [nom, setNom] = useState("");
  const [emoji, setEmoji] = useState("");
  const [categorie, setCategorie] = useState(categorieInitiale);
  const [region, setRegion] = useState({ debut: 0, fin: MEME_DUREE_MAX_MS });
  // Préparation gardée tant que l'extrait ne bouge pas : « Tester » puis
  // « Envoyer » ne réencodent qu'une fois.
  const [prepare, setPrepare] = useState<{ cle: string; resultat: MemePrepare } | null>(null);
  const [occupe, setOccupe] = useState<null | "analyse" | "tester" | "envoyer">(null);
  const [essai, setEssai] = useState<string | null>(null);
  const finirEssai = useCallback(() => {
    setEssai(null);
    libererLecteurActif(ESSAI);
  }, []);
  useEffect(() => () => libererLecteurActif(ESSAI), []);
  const [erreur, setErreur] = useState<string | null>(null);
  const entree = useRef<HTMLInputElement>(null);
  const cle = `${source}:${region.debut}:${region.fin}`;
  // Numéro du dernier fichier choisi : l'analyse d'un fichier remplacé entre-
  // temps ne doit rien écrire. Sans lui, un gros fichier choisi puis
  // remplacé par un petit finissait après lui, et l'on envoyait le premier
  // sous le nom du second.
  const choixRef = useRef(0);

  const choisir = async (f: File) => {
    const numero = ++choixRef.current;
    setFichier(f);
    setSource(null);
    setAnalyse(null);
    setPrepare(null);
    setErreur(null);
    if (!nom) setNom(f.name.replace(/\.[^.]+$/, "").slice(0, 40));
    setOccupe("analyse");
    try {
      const chemin = await deposerSource(f);
      const a = await analyserMeme(chemin);
      if (numero !== choixRef.current) return;
      setSource(chemin);
      setAnalyse(a);
      setRegion({ debut: 0, fin: Math.min(MEME_DUREE_MAX_MS, a.duree_ms) });
    } catch (err) {
      if (numero === choixRef.current) setErreur(`${t("memeboard.prepareError")} — ${String(err)}`);
    } finally {
      if (numero === choixRef.current) setOccupe(null);
    }
  };

  const preparer = async (): Promise<MemePrepare> => {
    if (prepare?.cle === cle) return prepare.resultat;
    if (!source) throw new Error("aucune source");
    const resultat = await preparerMeme(source, region.debut, region.fin - region.debut);
    setPrepare({ cle, resultat });
    return resultat;
  };

  const tester = async () => {
    setOccupe("tester");
    setErreur(null);
    try {
      const p = await preparer();
      definirLecteurActif(ESSAI);
      setEssai(p.video);
    } catch (err) {
      setErreur(`${t("memeboard.prepareError")} — ${String(err)}`);
    } finally {
      setOccupe(null);
    }
  };

  const envoyer = async () => {
    setOccupe("envoyer");
    setErreur(null);
    try {
      await envoyerMeme(await preparer(), nom, emoji.trim() || null, normaliserCategorie(categorie));
      onEnvoye();
    } catch (err) {
      setErreur(`${t("memeboard.sendError")} — ${String(err)}`);
      setOccupe(null);
    }
  };

  const pret = !!analyse && occupe === null;

  return (
    <div style={FOND}>
      <div style={{ ...CARTE, width: 560 }}>
        <div className="sion-titre" style={{ fontSize: 16, fontWeight: 700 }}>{t("memeboard.importTitle")}</div>
        <div style={{ fontSize: 12, color: 'var(--color-on-surface-variant)' }}>{t("memeboard.limits")}</div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <button type="button" style={styleBouton(false)} onClick={() => entree.current?.click()}>{t("memeboard.fromFile")}</button>
          <button type="button" style={styleBouton(false)} onClick={() => setLien(true)}>{t("memeboard.fromLink")}</button>
          {fichier && (
            <span style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fichier.name}
            </span>
          )}
          <input
            ref={entree}
            type="file"
            accept="video/*,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void choisir(f); e.target.value = ""; }}
          />
        </div>

        {fichier && <ChampsNomEmoji nom={nom} onNom={setNom} emoji={emoji} onEmoji={setEmoji} />}
        {fichier && <ChampCategorie valeur={categorie} onChange={setCategorie} categories={categories} />}

        {occupe === "analyse" && (
          <div style={{ fontSize: 12, color: 'var(--color-outline)' }}>{t("memeboard.analysing")}</div>
        )}
        {source && analyse && (
          <MemeTrimmer
            source={source}
            dureeMs={analyse.duree_ms}
            onChange={(debut, fin) => setRegion({ debut, fin })}
            essai={essai}
            onFinEssai={finirEssai}
          />
        )}

        {prepare?.cle === cle && (
          <div style={{ fontSize: 12, color: 'var(--color-on-surface-variant)' }}>
            {t("memeboard.prepared", {
              duree: (prepare.resultat.duree_ms / 1000).toFixed(1),
              poids: (prepare.resultat.taille / 1024 / 1024).toFixed(1),
            })}
          </div>
        )}
        {erreur && <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{erreur}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={styleBouton(false)} onClick={onClose}>{t("memeboard.cancel")}</button>
          <button type="button" style={styleBouton(false, pret)} disabled={!pret} onClick={() => void tester()}>
            {occupe === "tester" ? t("memeboard.preparing") : t("memeboard.test")}
          </button>
          <button type="button" style={styleBouton(true, pret)} disabled={!pret} onClick={() => void envoyer()}>
            {occupe === "envoyer" ? t("memeboard.sending") : t("memeboard.send")}
          </button>
        </div>
      </div>

      {lien && (
        <div>
          <Suspense fallback={null}>
            <ExternalVideoImport
              onClose={() => setLien(false)}
              onImported={(f) => { setLien(false); void choisir(f); }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
