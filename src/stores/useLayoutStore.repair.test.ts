import "../test/interface";
import { describe, expect, it } from "vitest";
import { useLayoutStore } from "./useLayoutStore";

async function rehydrater(state: unknown, version: number) {
  localStorage.setItem("sion-layout", JSON.stringify({ state, version }));
  await useLayoutStore.persist.rehydrate();
  return useLayoutStore.getState();
}

describe("réhydratation de la disposition", () => {
  it("ajoute la taille du haut aux préférences existantes et conserve sa position au redémarrage", async () => {
    expect((await rehydrater({ panneaux: ["members"], positionsPanneaux: { members: "right" } }, 7)).hauteurPanneauxHaut).toBe(280);
    useLayoutStore.getState().deplacerPanneau("members", "top");
    useLayoutStore.getState().setLargeurPanneau(240, "top");
    const sauve = JSON.parse(localStorage.getItem("sion-layout")!).state;
    const s = await rehydrater(sauve, 7);
    expect(s.positionsPanneaux.members).toBe("top");
    expect(s.hauteurPanneauxHaut).toBe(240);
    s.fermerPanneau("members"); s.ouvrirPanneau("members");
    expect(useLayoutStore.getState().positionsPanneaux.members).toBe("top");
  });
  it("reprend une ancienne rangée supérieure v5", async () => {
    const s = await rehydrater({ dockZones: { top: { panels: ["members"], size: 260 } } }, 5);
    expect(s.panneaux).toEqual(["members"]);
    expect(s.positionsPanneaux.members).toBe("top");
    expect(s.hauteurPanneauxHaut).toBe(260);
  });
  it("migre une v5, conserve ses panneaux ancrés et les fonds", async () => {
    const s = await rehydrater({
      sidebarWidth: 320, sidebarMode: "rail", sidebarSide: "right",
      dockZones: { right: { panels: ["soundboard", "members"], active: "members", size: 420 } },
      floatingPanels: { transcript: { x: 10, y: 20, w: 300, h: 400 } }, voiceInMenu: false,
      panelBackgrounds: { chat: { path: "/fond.webp", opacity: 0.4 } },
      shareDock: "floating", shareViewMaxVh: 35,
    }, 5);
    expect(s).toMatchObject({ panneau: "members", largeurPanneau: 420, sidebarWidth: 320, sidebarMode: "rail", sidebarSide: "right", shareDock: "floating", shareViewMaxVh: 35, panelBackgrounds: { chat: { path: "/fond.webp", opacity: 0.4 } } });
    expect(s.panneaux).toEqual(["soundboard", "members"]);
    for (const champ of ["dockZones", "floatingPanels", "voiceInMenu", "layoutEditing", "draggingPanel"]) expect(s).not.toHaveProperty(champ);
  });
  it("tolère une ancienne zone manquante et choisit le premier panneau valide", async () => {
    const s = await rehydrater({ dockZones: { right: { panels: ["voice", "pinned"], size: 200 } } }, 4);
    expect(s.panneau).toBe("pinned");
    expect(s.largeurPanneau).toBe(300);
  });
  it("le bloc vocal ne devient jamais un panneau latéral", async () => {
    const s = await rehydrater({ dockZones: { right: { panels: ["voice"], active: "voice" } } }, 5);
    expect(s.panneau).toBeNull();
  });
  it("tolère une ancienne liste de panneaux abîmée", async () => {
    const s = await rehydrater({ dockZones: { right: { panels: "soundboard", size: 380 } } }, 5);
    expect(s.panneau).toBeNull();
    expect(s.largeurPanneau).toBe(380);
  });
  it("migre aussi les préférences v1 et v2", async () => {
    expect((await rehydrater({ rightPanelWidth: 380, sidebarWidth: 300 }, 1)).largeurPanneau).toBe(380);
    expect((await rehydrater({ rightPanelWidths: { members: 400, soundboard: 340 } }, 2)).largeurPanneau).toBe(400);
  });
  it("répare même une v6 abîmée sans écraser les actions", async () => {
    const s = await rehydrater({ panneau: "voice", largeurPanneau: 9999, sidebarMode: "invalide", dockZones: {}, ouvrirPanneau: "invalide" }, 6);
    expect(s.panneau).toBeNull();
    expect(s.largeurPanneau).toBe(520);
    expect(s.sidebarMode).toBe("full");
    expect(s).not.toHaveProperty("dockZones");
    s.ouvrirPanneau("soundboard");
    expect(useLayoutStore.getState().panneau).toBe("soundboard");
  });
  it("reprend le panneau ouvert en v6 et filtre une liste v7 abîmée", async () => {
    expect((await rehydrater({ panneau: "memeboard", largeurPanneau: 390 }, 6)).panneaux).toEqual(["memeboard"]);
    const s = await rehydrater({ panneaux: ["soundboard", "soundboard", "voice", "memeboard"], positionsPanneaux: { soundboard: "bottom", memeboard: "invalide", voice: "left" } }, 7);
    expect(s.panneaux).toEqual(["soundboard", "memeboard"]);
    expect(s.positionsPanneaux).toEqual({ soundboard: "bottom" });
    expect(s.ouvrirPanneau).toBeTypeOf("function");
  });
});
