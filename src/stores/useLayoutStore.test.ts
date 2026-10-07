import "../test/interface";
import { describe, it, expect, beforeEach } from "vitest";
import { useLayoutStore, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_RAIL_SNAP_IN, SIDEBAR_RAIL_SNAP_OUT, SHARE_VIEW_DEFAULT_VH, SHARE_VIEW_MIN_VH, SHARE_VIEW_MAX_VH, SHARE_FLOATING_MIN_W, SHARE_FLOATING_MIN_H } from "./useLayoutStore";
const K = {
  DEFAULT: SIDEBAR_DEFAULT_WIDTH, MIN: SIDEBAR_MIN_WIDTH, MAX: SIDEBAR_MAX_WIDTH,
  SNAP_IN: SIDEBAR_RAIL_SNAP_IN, SNAP_OUT: SIDEBAR_RAIL_SNAP_OUT,
  SV_DEFAULT: SHARE_VIEW_DEFAULT_VH, SV_MIN: SHARE_VIEW_MIN_VH, SV_MAX: SHARE_VIEW_MAX_VH,
  FL_MIN_W: SHARE_FLOATING_MIN_W, FL_MIN_H: SHARE_FLOATING_MIN_H,
};
const store = new Proxy({} as Record<string, string>, { get: (_, key) => localStorage.getItem(String(key)) });
const reset = () => useLayoutStore.setState({
  sidebarWidth: K.DEFAULT, sidebarMode: "full", sidebarSide: "left",
  panneau: null, largeurPanneau: 360, panelBackgrounds: {},
  shareViewMaxVh: K.SV_DEFAULT, shareDock: "inline", shareFloating: { x: -1, y: -1, w: 440, h: 300 },
});
describe("useLayoutStore — sidebar modulable", () => {
  beforeEach(reset);

  it("borne la largeur entre MIN et MAX en mode déployé", () => {
    useLayoutStore.getState().setSidebarWidth(1000);
    expect(useLayoutStore.getState().sidebarWidth).toBe(K.MAX);

    useLayoutStore.getState().setSidebarWidth(K.MIN + 20);
    expect(useLayoutStore.getState().sidebarWidth).toBe(K.MIN + 20);
  });

  it("accroche le rail quand le drag descend sous le seuil bas", () => {
    useLayoutStore.getState().setSidebarWidth(K.SNAP_IN - 1);
    expect(useLayoutStore.getState().sidebarMode).toBe("rail");
    // La dernière largeur déployée est conservée pour le redéploiement.
    expect(useLayoutStore.getState().sidebarWidth).toBe(K.DEFAULT);
  });

  it("ne redéploie qu'au-dessus du seuil haut (hystérésis anti-va-et-vient)", () => {
    useLayoutStore.getState().setSidebarWidth(K.SNAP_IN - 1); // → rail
    // Entre les deux seuils : zone morte, on reste en rail.
    useLayoutStore.getState().setSidebarWidth(K.SNAP_OUT - 1);
    expect(useLayoutStore.getState().sidebarMode).toBe("rail");

    // Au seuil haut : redéploiement, largeur bornée au minimum déployé.
    useLayoutStore.getState().setSidebarWidth(K.SNAP_OUT);
    expect(useLayoutStore.getState().sidebarMode).toBe("full");
    expect(useLayoutStore.getState().sidebarWidth).toBe(K.MIN);
  });

  it("Ctrl+B cycle déployé → rail → masqué → déployé (largeur conservée)", () => {
    useLayoutStore.getState().setSidebarWidth(320);
    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarMode).toBe("rail");

    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarMode).toBe("hidden");

    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarMode).toBe("full");
    expect(useLayoutStore.getState().sidebarWidth).toBe(320);
  });

  it("mode masqué : le drag n'a plus d'effet, setSidebarMode ramène le rail", () => {
    useLayoutStore.getState().setSidebarWidth(320);
    useLayoutStore.getState().setSidebarMode("hidden");

    // Aucune poignée à tirer quand la sidebar est masquée.
    useLayoutStore.getState().setSidebarWidth(1000);
    expect(useLayoutStore.getState().sidebarMode).toBe("hidden");
    expect(useLayoutStore.getState().sidebarWidth).toBe(320);

    // Poignée de révélation : un clic ramène le rail, la largeur est intacte.
    useLayoutStore.getState().setSidebarMode("rail");
    expect(useLayoutStore.getState().sidebarMode).toBe("rail");
    expect(useLayoutStore.getState().sidebarWidth).toBe(320);
  });

  it("resetSidebar revient à la largeur par défaut, déployé", () => {
    useLayoutStore.getState().setSidebarWidth(K.SNAP_IN - 1);
    useLayoutStore.getState().resetSidebar();
    expect(useLayoutStore.getState().sidebarMode).toBe("full");
    expect(useLayoutStore.getState().sidebarWidth).toBe(K.DEFAULT);
  });

  it("le menu change de côté (gauche ↔ droite) et le choix est persisté", () => {
    const s = () => useLayoutStore.getState();
    expect(s().sidebarSide).toBe("left");

    s().toggleSidebarSide();
    expect(s().sidebarSide).toBe("right");
    expect(JSON.parse(store["sion-layout"]).state.sidebarSide).toBe("right");

    s().setSidebarSide("left");
    expect(s().sidebarSide).toBe("left");

  });

  it("persiste le layout sous la clé sion-layout (mémoire au relaunch)", () => {
    useLayoutStore.getState().setSidebarWidth(320);
    useLayoutStore.getState().toggleSidebar(); // → rail
    const raw = store["sion-layout"];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.state.sidebarWidth).toBe(320);
    expect(parsed.state.sidebarMode).toBe("rail");
  });

});
describe("useLayoutStore — panneau unique", () => {
  beforeEach(reset);
  it("un seul panneau ouvert à la fois", () => {
    useLayoutStore.getState().ouvrirPanneau("soundboard");
    useLayoutStore.getState().ouvrirPanneau("members");
    expect(useLayoutStore.getState().panneau).toBe("members");
  });
  it("basculer referme le panneau actif", () => {
    useLayoutStore.getState().basculerPanneau("soundboard");
    expect(useLayoutStore.getState().panneau).toBe("soundboard");
    useLayoutStore.getState().basculerPanneau("soundboard");
    expect(useLayoutStore.getState().panneau).toBeNull();
    useLayoutStore.getState().ouvrirPanneau("pinned");
    useLayoutStore.getState().fermerPanneau();
    expect(useLayoutStore.getState().panneau).toBeNull();
  });
  it("borne la largeur et répare une valeur non numérique", () => {
    useLayoutStore.getState().setLargeurPanneau(100);
    expect(useLayoutStore.getState().largeurPanneau).toBe(300);
    useLayoutStore.getState().setLargeurPanneau(2000);
    expect(useLayoutStore.getState().largeurPanneau).toBe(520);
    useLayoutStore.getState().setLargeurPanneau(NaN);
    expect(useLayoutStore.getState().largeurPanneau).toBe(360);
  });
  it("persiste panneau, largeur et fonds sans les champs supprimés", () => {
    useLayoutStore.getState().ouvrirPanneau("pinned");
    useLayoutStore.getState().setLargeurPanneau(410);
    useLayoutStore.getState().setPanelBackground("chat", { path: "/fond.webp", opacity: 0.4 });
    const raw = JSON.parse(localStorage.getItem("sion-layout")!);
    expect(raw.version).toBe(6);
    expect(raw.state).toMatchObject({ panneau: "pinned", largeurPanneau: 410, panelBackgrounds: { chat: { path: "/fond.webp", opacity: 0.4 } } });
    expect(Object.keys(raw.state).sort()).toEqual(["sidebarWidth", "sidebarMode", "sidebarSide", "panneau", "largeurPanneau", "panelBackgrounds", "shareViewMaxVh", "shareDock", "shareFloating"].sort());
  });
});
describe("useLayoutStore — zone de partage", () => {
  beforeEach(reset);

  it("borne la hauteur de la zone de partage et la réinitialise", () => {
    const s = () => useLayoutStore.getState();

    s().setShareViewMaxVh(1);
    expect(s().shareViewMaxVh).toBe(K.SV_MIN);

    s().setShareViewMaxVh(500);
    expect(s().shareViewMaxVh).toBe(K.SV_MAX);

    s().setShareViewMaxVh(30);
    expect(s().shareViewMaxVh).toBe(30);

    s().resetShareViewMaxVh();
    expect(s().shareViewMaxVh).toBe(K.SV_DEFAULT);
  });

  it("bascule le dock du partage et mémorise la position flottante", () => {
    const s = () => useLayoutStore.getState();
    expect(s().shareDock).toBe("inline");

    s().toggleShareDock();
    expect(s().shareDock).toBe("floating");

    s().setShareFloating({ x: 120, y: 80 });
    expect(s().shareFloating.x).toBe(120);
    expect(s().shareFloating.y).toBe(80);
    // Merge partiel : la taille par défaut est conservée.
    expect(s().shareFloating.w).toBe(440);

    // Planchers de taille appliqués même via un merge partiel.
    s().setShareFloating({ w: 10, h: 10 });
    expect(s().shareFloating.w).toBe(K.FL_MIN_W);
    expect(s().shareFloating.h).toBe(K.FL_MIN_H);

    s().toggleShareDock();
    expect(s().shareDock).toBe("inline");
  });
});

