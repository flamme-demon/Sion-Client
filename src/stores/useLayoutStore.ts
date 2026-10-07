import { create } from "zustand";
import { persist } from "zustand/middleware";

// Dimensions du layout desktop. La sidebar est la première pièce modulable :
// déployée librement entre MIN et MAX, repliée en rail d'icônes, ou masquée.
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
/** Largeur du rail d'icônes (mode replié). */
export const SIDEBAR_RAIL_WIDTH = 72;

/**
 * Seuils d'accroche (hystérésis) entre les deux états. Pendant un drag, la
 * largeur redescend sous MIN : c'est le signal du passage au rail. Mais il
 * faut remonter nettement au-dessus pour redéployer — sinon un pointeur qui
 * traîne pile sur le seuil ferait clignoter la sidebar entre les deux états.
 */
export const SIDEBAR_RAIL_SNAP_IN = 160;
export const SIDEBAR_RAIL_SNAP_OUT = 190;

/** Déployé, rail d'icônes, ou masqué (le bord garde une poignée de
 *  révélation, et Ctrl+B cycle les trois états). */
export type SidebarMode = "full" | "rail" | "hidden";

/** Côté du menu principal : à gauche (défaut) ou à droite. En bas, jamais —
 *  une liste de salons horizontale n'a aucun sens. */
export type SidebarSide = "left" | "right";

/** Ordre du cycle Ctrl+B : déployé → rail → masqué → déployé. */
const SIDEBAR_MODE_CYCLE: readonly SidebarMode[] = ["full", "rail", "hidden"];

export const PANNEAU_IDS = ["members", "soundboard", "memeboard", "transcript", "pinned"] as const;
export type PanneauId = typeof PANNEAU_IDS[number];
export const PANNEAU_MIN_WIDTH = 300;
export const PANNEAU_MAX_WIDTH = 520;
export const PANNEAU_DEFAULT_WIDTH = 360;
const estPanneau = (id: unknown): id is PanneauId => PANNEAU_IDS.includes(id as PanneauId);
const borne = (v: unknown, min: number, max: number, defaut: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaut;
const largeurPanneau = (v: unknown) => borne(v, PANNEAU_MIN_WIDTH, PANNEAU_MAX_WIDTH, PANNEAU_DEFAULT_WIDTH);

function persistSoundboardAtLaunch(open: boolean): void {
  import("./useSettingsStore")
    .then(({ useSettingsStore }) => useSettingsStore.getState().setSoundboardOpenAtLaunch(open))
    .catch(() => { /* hors Tauri : sans conséquence */ });
}

/** Zone de partage d'écran en ligne (dans le chat) : hauteur maximale de la
 *  vidéo, en % de la fenêtre. La réduire rend la place au chat. */
export const SHARE_VIEW_DEFAULT_VH = 50;
export const SHARE_VIEW_MIN_VH = 8;
export const SHARE_VIEW_MAX_VH = 85;

const clampShareViewVh = (v: number) =>
  Math.min(SHARE_VIEW_MAX_VH, Math.max(SHARE_VIEW_MIN_VH, v));

/** Affichage du partage : en ligne dans le chat, ou carte flottante
 *  détachable (PIP interne). */
export type ShareDock = "inline" | "floating";
export const SHARE_FLOATING_MIN_W = 260;
export const SHARE_FLOATING_MIN_H = 160;
/** Défaut de la carte flottante : x/y < 0 = « coller en bas à droite » — la
 *  taille de fenêtre n'est pas connue du store, le calcul se fait au rendu. */
const SHARE_FLOATING_DEFAULT = { x: -1, y: -1, w: 440, h: 300 };

const clampWidth = (w: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w));

/** Portée d'un fond d'image : le chat, le menu des salons, ou un panneau latéral. */
export type BackgroundScope = "chat" | "channels" | PanneauId;

/** Fond d'image d'un panneau : chemin local + opacité. L'image est posée SOUS
 *  le fond du thème, donc le contraste du texte ne dépend pas du fond.
 *  `mode` : `veil` (voile de surface sur l'image, par défaut) ou `blur`
 *  (image pleine dans un calque flouté — la lisibilité vient du flou).
 *  `anchor` : zone de l'image conservée quand elle est recadrée (image plus
 *  grande que le panneau, `cover`) — `mc` (centre) par défaut. */
export type BgAnchor = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";

export interface PanelBackgroundCfg {
  path: string;
  opacity: number;
  mode?: "veil" | "blur";
  anchor?: BgAnchor;
  /** Obsolète, conservé pour les états déjà enregistrés. Un fond animé n'est
   *  plus une vidéo : `prepare_background_video` en tire un WebP animé, donc
   *  une image, qui passe par le même chemin CSS que les fonds fixes. */
  video?: boolean;
}

interface LayoutState {
  sidebarWidth: number;
  sidebarMode: SidebarMode;
  sidebarSide: SidebarSide;
  panneau: PanneauId | null;
  largeurPanneau: number;
  shareViewMaxVh: number;
  shareDock: ShareDock;
  shareFloating: { x: number; y: number; w: number; h: number };
  panelBackgrounds: Partial<Record<BackgroundScope, PanelBackgroundCfg>>;
  setSidebarWidth: (raw: number) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  toggleSidebar: () => void;
  setSidebarSide: (side: SidebarSide) => void;
  toggleSidebarSide: () => void;
  resetSidebar: () => void;
  ouvrirPanneau: (id: PanneauId) => void;
  basculerPanneau: (id: PanneauId) => void;
  fermerPanneau: () => void;
  setLargeurPanneau: (px: number) => void;
  setPanelBackground: (scope: BackgroundScope, cfg: PanelBackgroundCfg | null) => void;
  setShareViewMaxVh: (vh: number) => void;
  resetShareViewMaxVh: () => void;
  setShareDock: (dock: ShareDock) => void;
  toggleShareDock: () => void;
  setShareFloating: (rect: Partial<{ x: number; y: number; w: number; h: number }>) => void;
}

/** Liste blanche : ni champs obsolètes ni actions importées depuis le stockage. */
function preferences(persisted: unknown) {
  const s = (persisted && typeof persisted === "object" ? persisted : {}) as Partial<LayoutState>;
  const rect = s.shareFloating;
  return {
    sidebarWidth: borne(s.sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_DEFAULT_WIDTH),
    sidebarMode: SIDEBAR_MODE_CYCLE.includes(s.sidebarMode as SidebarMode) ? s.sidebarMode! : "full" as SidebarMode,
    sidebarSide: s.sidebarSide === "right" ? "right" as SidebarSide : "left" as SidebarSide,
    panneau: estPanneau(s.panneau) ? s.panneau : null,
    largeurPanneau: largeurPanneau(s.largeurPanneau),
    panelBackgrounds: Object.fromEntries(Object.entries(s.panelBackgrounds ?? {}).filter(([id, cfg]) =>
      (id === "chat" || id === "channels" || estPanneau(id)) && cfg && typeof cfg.path === "string")),
    shareViewMaxVh: borne(s.shareViewMaxVh, SHARE_VIEW_MIN_VH, SHARE_VIEW_MAX_VH, SHARE_VIEW_DEFAULT_VH),
    shareDock: s.shareDock === "floating" ? "floating" as ShareDock : "inline" as ShareDock,
    shareFloating: {
      x: typeof rect?.x === "number" && Number.isFinite(rect.x) ? rect.x : -1,
      y: typeof rect?.y === "number" && Number.isFinite(rect.y) ? rect.y : -1,
      w: borne(rect?.w, SHARE_FLOATING_MIN_W, Number.MAX_SAFE_INTEGER, SHARE_FLOATING_DEFAULT.w),
      h: borne(rect?.h, SHARE_FLOATING_MIN_H, Number.MAX_SAFE_INTEGER, SHARE_FLOATING_DEFAULT.h),
    },
  };
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      ...preferences({}),
      setSidebarWidth: (raw) =>
        set((s) => {
          if (s.sidebarMode === "hidden") return {};
          if (s.sidebarMode === "full") {
            if (raw < SIDEBAR_RAIL_SNAP_IN) return { sidebarMode: "rail" as SidebarMode };
            return { sidebarWidth: clampWidth(raw) };
          }
          // Mode rail : il faut un geste franc vers la droite pour redéployer.
          if (raw >= SIDEBAR_RAIL_SNAP_OUT) {
            return { sidebarMode: "full" as SidebarMode, sidebarWidth: clampWidth(raw) };
          }
          return {};
        }),
      setSidebarMode: (mode) => set({ sidebarMode: mode }),
      toggleSidebar: () =>
        set((s) => {
          const next = SIDEBAR_MODE_CYCLE[(SIDEBAR_MODE_CYCLE.indexOf(s.sidebarMode) + 1) % SIDEBAR_MODE_CYCLE.length];
          return { sidebarMode: next };
        }),
      resetSidebar: () => set({ sidebarMode: "full" as SidebarMode, sidebarWidth: SIDEBAR_DEFAULT_WIDTH }),
      setSidebarSide: (side) => set({ sidebarSide: side }),
      toggleSidebarSide: () =>
        set((s) => ({ sidebarSide: s.sidebarSide === "left" ? ("right" as SidebarSide) : ("left" as SidebarSide) })),
      setPanelBackground: (scope, cfg) =>
        set((s) => {
          const next = { ...s.panelBackgrounds };
          if (cfg) next[scope] = cfg;
          else delete next[scope];
          return { panelBackgrounds: next };
        }),
      ouvrirPanneau: (id) => set(() => {
        persistSoundboardAtLaunch(id === "soundboard");
        return { panneau: id };
      }),
      basculerPanneau: (id) => set((s) => {
        const panneau = s.panneau === id ? null : id;
        persistSoundboardAtLaunch(panneau === "soundboard");
        return { panneau };
      }),
      fermerPanneau: () => set(() => {
        persistSoundboardAtLaunch(false);
        return { panneau: null };
      }),
      setLargeurPanneau: (px) => set({ largeurPanneau: largeurPanneau(px) }),
      setShareViewMaxVh: (vh) => set({ shareViewMaxVh: clampShareViewVh(vh) }),
      resetShareViewMaxVh: () => set({ shareViewMaxVh: SHARE_VIEW_DEFAULT_VH }),
      shareDock: "inline" as ShareDock,
      shareFloating: { ...SHARE_FLOATING_DEFAULT },
      setShareDock: (dock) => set({ shareDock: dock }),
      toggleShareDock: () =>
        set((s) => ({ shareDock: s.shareDock === "inline" ? ("floating" as ShareDock) : ("inline" as ShareDock) })),
      setShareFloating: (rect) =>
        set((s) => ({
          shareFloating: {
            ...s.shareFloating,
            ...rect,
            w: Math.max(SHARE_FLOATING_MIN_W, rect.w ?? s.shareFloating.w),
            h: Math.max(SHARE_FLOATING_MIN_H, rect.h ?? s.shareFloating.h),
          },
        })),
    }),
    {
      name: "sion-layout",
      version: 6,
      partialize: (s) => preferences(s),
      merge: (saved, current) => ({ ...current, ...preferences(saved) }),
      migrate: (saved, version) => {
        const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
        if (version >= 6) return preferences(s);
        const right = (s.dockZones as { right?: { active?: unknown; panels?: unknown[]; size?: number } } | undefined)?.right;
        const legacy = s.rightPanelWidths as Record<string, number> | undefined;
        const oldWidth = right?.size ?? s.rightPanelWidth ?? (legacy ? Math.max(...Object.values(legacy)) : undefined);
        return preferences({
          ...s,
          panneau: estPanneau(right?.active) ? right.active : Array.isArray(right?.panels) ? right.panels.find(estPanneau) ?? null : null,
          largeurPanneau: oldWidth,
        });
      },
    },
  ),
);
