import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PanneauLateral, CiblesModules } from "./PanneauLateral";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useApercuPlacementModule } from "./apercuPlacementModule";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./panneaux", () => ({
  PANNEAU_TITRES: { soundboard: "soundboard.title", members: "members.title", memeboard: "memeboard.title" },
  PANNEAU_CORPS: { soundboard: () => <div>Sons</div>, members: () => <div>Membres</div>, memeboard: () => <div>Memes</div> },
  PANNEAU_COMPTEURS: {},
}));
const vue = montage();
const elementSousPointeur = vi.fn<() => Element | null>();
const calquesSousCible = vi.fn<() => Element[]>();
beforeEach(() => {
  useLayoutStore.setState({ panneau: null, panneaux: [], positionsPanneaux: {}, panneauEnDeplacement: null, largeurPanneau: 360, largeurPanneauGauche: 360, hauteurPanneauxBas: 280, hauteurPanneauxHaut: 280 });
  useApercuPlacementModule.getState().liberer();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("sion-main-area")) return new DOMRect(0, 0, 1000, 800);
    const colonne = this.closest<HTMLElement>("[data-zone-panneaux]");
    if (!colonne || !this.dataset.panneau) return new DOMRect();
    const cartes = Array.from(colonne.querySelectorAll("[data-panneau]"));
    const i = cartes.indexOf(this), n = cartes.length;
    if (colonne.dataset.zonePanneaux === "bottom") return new DOMRect(i * 1000 / n, 600, 1000 / n, 200);
    if (colonne.dataset.zonePanneaux === "top") return new DOMRect(i * 1000 / n, 0, 1000 / n, 200);
    return new DOMRect(colonne.dataset.zonePanneaux === "left" ? 0 : 640, i * 600 / n, 360, 600 / n);
  });
  elementSousPointeur.mockReset();
  calquesSousCible.mockReturnValue([]);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: elementSousPointeur });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => {
    const premier = elementSousPointeur();
    return premier ? [premier, ...calquesSousCible()] : [];
  } });
});
const layout = (onDrop?: () => void) => <div className="sion-main-area" onDrop={onDrop}>
  <PanneauLateral zone="top" />
  <div className="sion-conversation-et-panneaux"><PanneauLateral zone="left" /><main /><PanneauLateral /></div>
  <PanneauLateral zone="bottom" /><CiblesModules />
</div>;
const pointer = async (element: Element, type: string, x = 30, y = 30) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  await act(async () => { element.dispatchEvent(event); });
};
const saisirPoignee = async (id: string) => {
  const titre = vue.container.querySelector<HTMLElement>(`[data-panneau="${id}"] .sion-panneau-titre`)!;
  let capture = false;
  Object.assign(titre, {
    setPointerCapture: vi.fn(() => { capture = true; }),
    hasPointerCapture: () => capture,
    releasePointerCapture: vi.fn(() => { capture = false; }),
  });
  await pointer(titre.querySelector(".sion-poignee-module")!, "pointerdown");
  return titre;
};
it("n'affiche rien sans panneau ouvert", async () => {
  await vue.render(<PanneauLateral />);
  expect(vue.container.childElementCount).toBe(0);
});
it("affiche le titre et un seul bouton Fermer", async () => {
  useLayoutStore.getState().ouvrirPanneau("soundboard");
  await vue.render(<PanneauLateral />);
  expect(vue.container.textContent).toContain("soundboard.title");
  expect(vue.container.querySelectorAll('[aria-label="chat.close"]')).toHaveLength(1);
  await vue.click('[aria-label="chat.close"]');
  expect(useLayoutStore.getState().panneau).toBeNull();
});
it("redimensionne au clavier et ferme avec Échap depuis le corps", async () => {
  useLayoutStore.getState().ouvrirPanneau("members");
  await vue.render(<PanneauLateral />);
  await act(async () => vue.container.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(useLayoutStore.getState().largeurPanneau).toBe(368);
  await act(async () => vue.container.querySelector("aside")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(useLayoutStore.getState().panneau).toBeNull();
});
it("affiche deux bulles et fermer l'une conserve l'autre", async () => {
  useLayoutStore.getState().ouvrirPanneau("soundboard"); useLayoutStore.getState().ouvrirPanneau("memeboard");
  await vue.render(<PanneauLateral />);
  expect(vue.container.querySelectorAll("aside")).toHaveLength(2);
  await vue.click('[data-panneau="soundboard"] [data-fermer-panneau]');
  expect(vue.container.querySelector('[data-panneau="memeboard"]')).not.toBeNull();
  expect(useLayoutStore.getState().panneaux).toEqual(["memeboard"]);
});
it("le menu replace une bulle et réordonne les voisines", async () => {
  useLayoutStore.getState().ouvrirPanneau("soundboard"); useLayoutStore.getState().ouvrirPanneau("memeboard");
  await vue.render(layout());
  const changer = async (id: string, valeur: string) => {
    const select = vue.container.querySelector<HTMLSelectElement>(`[data-panneau="${id}"] select`)!;
    await act(async () => { select.value = valeur; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  await changer("soundboard", "down");
  expect(Array.from(vue.container.querySelectorAll("[data-panneau]")).map((e) => e.getAttribute("data-panneau"))).toEqual(["memeboard", "soundboard"]);
  await changer("soundboard", "bottom");
  expect(vue.container.querySelector('[data-zone-panneaux="bottom"] [data-panneau="soundboard"]')).not.toBeNull();
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("bottom");
  await changer("soundboard", "top");
  expect(vue.container.querySelector('[data-zone-panneaux="top"] [data-panneau="soundboard"]')).not.toBeNull();
  const hauteurBas = useLayoutStore.getState().hauteurPanneauxBas;
  await act(async () => vue.container.querySelector('[data-zone-panneaux="top"] [role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(useLayoutStore.getState().hauteurPanneauxHaut).toBe(288);
  expect(useLayoutStore.getState().hauteurPanneauxBas).toBe(hauteurBas);
  await act(async () => vue.container.querySelector('[data-zone-panneaux="top"] [role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(useLayoutStore.getState().hauteurPanneauxHaut).toBe(100);
});
it("montre immédiatement le module saisi sans déplacer ni enregistrer ses préférences", async () => {
  useLayoutStore.setState({ panneaux: ["soundboard"], positionsPanneaux: { soundboard: "right" } });
  await vue.render(layout());
  const stockage = localStorage.getItem("sion-layout");
  const titre = await saisirPoignee("soundboard");
  expect(document.querySelector(".sion-module-en-main")?.textContent).toContain("soundboard.title");
  expect(document.querySelector(".sion-module-en-main")?.textContent).toContain("layout.moveToEdge");
  expect(titre.closest("[data-panneau]")?.classList.contains("sion-module-saisi")).toBe(true);
  expect(document.body.classList.contains("layout-deplacement-module")).toBe(true);
  expect(useLayoutStore.getState().panneauEnDeplacement).toBeNull();
  await pointer(titre, "pointermove", 32, 30);
  expect(useApercuPlacementModule.getState().saisie).toMatchObject({ x: 32, y: 30 });
  expect(localStorage.getItem("sion-layout")).toBe(stockage);
  await pointer(titre, "pointerup", 32, 30);
  expect(document.querySelector(".sion-module-en-main")).toBeNull();
  expect(document.querySelector(".sion-module-saisi")).toBeNull();
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("right");
});
it("le bord supérieur est accessible même sans module en haut", async () => {
  useLayoutStore.setState({ panneaux: ["soundboard"], positionsPanneaux: { soundboard: "bottom" } });
  await vue.render(layout());
  const titre = await saisirPoignee("soundboard");
  await pointer(titre, "pointermove", 500, 50);
  expect(vue.container.querySelector('[data-apercu-zone="top"]')?.textContent).toContain("layout.zoneTop");
  expect(document.querySelector(".sion-module-en-main")?.textContent).toContain("layout.dropPanelHere");
  await pointer(titre, "pointerup", 500, 50);
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("top");
});
it("un déplacement au pointeur vers une zone vide ne déclenche pas le dépôt de fichiers du chat", async () => {
  const chat = vi.fn();
  useLayoutStore.getState().ouvrirPanneau("soundboard");
  await vue.render(layout(chat));
  const titre = await saisirPoignee("soundboard");
  await pointer(titre, "pointermove", 500, 720);
  expect(vue.container.querySelector('[data-apercu-zone="bottom"]')).not.toBeNull();
  expect(vue.container.querySelectorAll("[data-cible-module]")).toHaveLength(0);
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBeUndefined();
  await pointer(titre, "pointerup", 500, 720);
  expect(chat).not.toHaveBeenCalled();
  expect(useLayoutStore.getState().panneauEnDeplacement).toBeNull();
  expect(vue.container.querySelector('[data-zone-panneaux="bottom"] [data-panneau="soundboard"]')).not.toBeNull();
});

it.each(["left", "top", "bottom"] as const)("les six points déplacent un module depuis %s vers la droite déjà occupée", async (origine) => {
  useLayoutStore.setState({ panneaux: ["soundboard", "memeboard"], positionsPanneaux: { soundboard: origine, memeboard: "right" } });
  await vue.render(layout());
  const titre = await saisirPoignee("soundboard");
  elementSousPointeur.mockReturnValue(vue.container.querySelector('[data-panneau="memeboard"] .sion-poignee-module'));
  await pointer(titre, "pointermove", 900, 100);
  expect(useLayoutStore.getState().panneauEnDeplacement).toBe("soundboard");
  expect(document.body.classList.contains("layout-deplacement-module")).toBe(true);
  expect(vue.container.querySelectorAll("[data-apercu-module]")).toHaveLength(1);
  expect(vue.container.querySelector('[data-apercu-zone="right"]')).not.toBeNull();
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe(origine);
  await pointer(titre, "pointerup", 900, 100);
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("right");
  expect(vue.container.querySelectorAll('[data-zone-panneaux="right"] [data-panneau]')).toHaveLength(2);
  expect(useLayoutStore.getState().panneauEnDeplacement).toBeNull();
  expect(document.body.classList.contains("layout-deplacement-module")).toBe(false);
  expect(titre.releasePointerCapture).toHaveBeenCalledWith(1);
});

it.each(["top", "bottom"] as const)("l'aperçu indique l'insertion horizontale en %s et le lâcher applique cet ordre", async (zone) => {
  useLayoutStore.setState({ panneaux: ["soundboard", "memeboard"], positionsPanneaux: { soundboard: zone, memeboard: zone } });
  await vue.render(layout());
  const titre = await saisirPoignee("memeboard");
  elementSousPointeur.mockReturnValue(vue.container.querySelector('[data-panneau="soundboard"] .sion-poignee-module'));
  const y = zone === "top" ? 100 : 650;
  await pointer(titre, "pointermove", 100, y);
  expect(useLayoutStore.getState().panneaux).toEqual(["soundboard", "memeboard"]);
  expect(Array.from(vue.container.querySelectorAll(`[data-apercu-colonne="${zone}"] [data-apercu-emplacement]`)).map((e) => e.getAttribute("data-apercu-emplacement"))).toEqual(["memeboard", "soundboard"]);
  await pointer(titre, "pointerup", 100, y);
  expect(useLayoutStore.getState().panneaux).toEqual(["memeboard", "soundboard"]);
});

it("glisser puis relâcher sur soi conserve l'ordre des modules", async () => {
  useLayoutStore.setState({ panneaux: ["soundboard", "memeboard"], positionsPanneaux: { soundboard: "right", memeboard: "right" } });
  await vue.render(layout());
  const titre = await saisirPoignee("soundboard");
  elementSousPointeur.mockReturnValue(titre);
  await pointer(titre, "pointermove", 850, 100);
  await pointer(titre, "pointerup", 850, 100);
  expect(useLayoutStore.getState().panneaux).toEqual(["soundboard", "memeboard"]);
  expect(useApercuPlacementModule.getState().cible).toBeNull();
});

it("passer d'un bord au centre masque l'aperçu et relâcher conserve le placement", async () => {
  useLayoutStore.setState({ panneaux: ["soundboard"], positionsPanneaux: { soundboard: "right" } });
  await vue.render(layout());
  const titre = await saisirPoignee("soundboard");
  await pointer(titre, "pointermove", 40, 300);
  expect(vue.container.querySelector('[data-apercu-zone="left"]')).not.toBeNull();
  await pointer(titre, "pointermove", 500, 300);
  expect(vue.container.querySelector('[data-apercu-module]')).toBeNull();
  expect(document.querySelector(".sion-module-en-main")?.textContent).toContain("layout.moveToEdge");
  expect(useLayoutStore.getState().panneauEnDeplacement).toBe("soundboard");
  await pointer(titre, "pointerup", 500, 300);
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("right");
});

it.each(["pointercancel", "lostpointercapture", "Escape", "blur"])("%s annule le geste sans modifier la position", async (annulation) => {
  useLayoutStore.setState({ panneaux: ["soundboard"], positionsPanneaux: { soundboard: "left" } });
  await vue.render(layout());
  const titre = await saisirPoignee("soundboard");
  await pointer(titre, "pointermove", 60, 60);
  if (annulation === "Escape") await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  else if (annulation === "blur") await act(async () => { window.dispatchEvent(new Event("blur")); });
  else await pointer(titre, annulation);
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("left");
  expect(useLayoutStore.getState().panneauEnDeplacement).toBeNull();
  expect(vue.container.querySelector(".sion-apercu-deplacement")).toBeNull();
  expect(useApercuPlacementModule.getState().cible).toBeNull();
  expect(useApercuPlacementModule.getState().saisie).toBeNull();
  expect(document.querySelector(".sion-module-en-main")).toBeNull();
  expect(document.querySelector(".sion-module-saisi")).toBeNull();
  expect(document.body.classList.contains("layout-deplacement-module")).toBe(false);
});

it("un clic sur les points et un lâcher hors des destinations ne déplacent pas le module", async () => {
  useLayoutStore.setState({ panneaux: ["soundboard"], positionsPanneaux: { soundboard: "bottom" } });
  await vue.render(layout());
  const titre = await saisirPoignee("soundboard");
  await pointer(titre, "pointermove", 32, 30);
  expect(useLayoutStore.getState().panneauEnDeplacement).toBeNull();
  await pointer(titre, "pointerup");
  await saisirPoignee("soundboard");
  await pointer(titre, "pointermove", 60, 60);
  elementSousPointeur.mockReturnValue(null);
  await pointer(titre, "pointerup", -1, -1);
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("bottom");
  expect(useLayoutStore.getState().panneauEnDeplacement).toBeNull();
});
