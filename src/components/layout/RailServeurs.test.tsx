import { montage } from "../../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { RailServeurs } from "./RailServeurs";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useAdminStore } from "../../stores/useAdminStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { act } from "react";
import { CiblesModules } from "./PanneauLateral";
import { useApercuPlacementModule } from "./apercuPlacementModule";

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../sidebar/AccountPopover", () => ({ AccountPopover: () => null }));
vi.mock("../../services/lazyScreens", () => ({ preloadHeavyScreens: vi.fn() }));
vi.mock("../../hooks/useFenetreEtroite", () => ({ useFenetreEtroite: () => false }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => null }));
const vue = montage();
beforeEach(() => {
  useLayoutStore.setState({ sidebarMode: "full", positionEspaces: "bottom", panneaux: [], panneauEnDeplacement: null });
  useApercuPlacementModule.getState().liberer();
  useAdminStore.setState({ isAdmin: false });
  useSettingsStore.setState({ sidebarView: "channels" });
  useMatrixStore.setState({ channels: [], messages: {} });
});
it("déplace la navigation au clavier tout en conservant les panneaux ouverts", async () => {
  useLayoutStore.setState({ panneaux: ["members"], positionsPanneaux: { members: "right" } });
  await vue.render(<RailServeurs />);
  const poignee = vue.container.querySelector('.sion-barre-espaces-poignee')!;
  await act(async () => { poignee.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
  expect(useLayoutStore.getState().positionEspaces).toBe("left");
  expect(useLayoutStore.getState().panneaux).toEqual(["members"]);
  expect(useLayoutStore.getState().positionsPanneaux).toEqual({ members: "right" });
});

it("les six points annoncent le placement puis déposent la barre au bord droit", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 800));
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  await vue.render(<div className="sion-main-area"><RailServeurs /><CiblesModules /></div>);
  const poignee = vue.container.querySelector<HTMLElement>('.sion-barre-espaces-poignee')!;
  Object.assign(poignee, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  const pointer = async (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    await act(async () => { poignee.dispatchEvent(event); });
  };
  await pointer("pointerdown", 30, 760);
  expect(document.querySelector(".sion-module-en-main")?.textContent).toContain("spaces.title");
  await pointer("pointermove", 970, 400);
  expect(vue.container.querySelector('[data-apercu-module="espaces"]')?.getAttribute("data-apercu-zone")).toBe("right");
  expect(useLayoutStore.getState().positionEspaces).toBe("bottom");
  await pointer("pointerup", 970, 400);
  expect(useLayoutStore.getState().positionEspaces).toBe("right");
  expect(useLayoutStore.getState().panneauEnDeplacement).toBeNull();
  expect(document.querySelector(".sion-module-en-main")).toBeNull();
});

it("dépose la barre tout à gauche, en dehors de la zone du chat et du menu des salons", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("app-root--desktop")) return new DOMRect(0, 0, 1000, 800);
    if (this.classList.contains("sion-main-area")) return new DOMRect(290, 0, 710, 800);
    return new DOMRect();
  });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  function Disposition() {
    const zone = useLayoutStore((s) => s.positionEspaces);
    return <div className="app-root app-root--desktop">
      <div data-module-salons>Salons</div>
      <div className="sion-main-area"><RailServeurs zone={zone} /><CiblesModules /></div>
    </div>;
  }
  await vue.render(<Disposition />);
  const poignee = vue.container.querySelector<HTMLElement>('.sion-barre-espaces-poignee')!;
  Object.assign(poignee, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  const pointer = async (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    await act(async () => { poignee.dispatchEvent(event); });
  };
  await pointer("pointerdown", 320, 760);
  await pointer("pointermove", 10, 400);
  expect(vue.container.querySelector('[data-apercu-module="espaces"]')?.getAttribute("data-apercu-zone")).toBe("left");
  await pointer("pointerup", 10, 400);
  expect(useLayoutStore.getState().positionEspaces).toBe("left");
  expect(vue.container.querySelector('.app-root--desktop > [data-zone-espaces="left"]')).not.toBeNull();
  expect(vue.container.querySelector('.sion-main-area [data-zone-espaces="left"]')).toBeNull();
  const nouvellePoignee = vue.container.querySelector('.sion-barre-espaces-poignee')!;
  await act(async () => nouvellePoignee.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(useLayoutStore.getState().positionEspaces).toBe("bottom");
  expect(vue.container.querySelector('.sion-main-area [data-zone-espaces="bottom"]')).not.toBeNull();
});
it("le logo replie et déplie la barre des salons", async () => {
  await vue.render(<RailServeurs />);
  await vue.click('[aria-label="layout.toggleSidebar"]');
  expect(useLayoutStore.getState().sidebarMode).toBe("rail");
});
it("ne montre Administration qu'aux admins", async () => {
  await vue.render(<RailServeurs />);
  expect(vue.container.querySelector('[aria-label="admin.title"]')).toBeNull();
  await act(async () => useAdminStore.setState({ isAdmin: null }));
  expect(vue.container.querySelector('[aria-label="admin.title"]')).toBeNull();
  await act(async () => useAdminStore.setState({ isAdmin: true }));
  await vue.render(<RailServeurs />);
  expect(vue.container.querySelector('[aria-label="admin.title"]')).not.toBeNull();
});
it("chaque bouton a un nom accessible", async () => {
  await vue.render(<RailServeurs />);
  for (const button of vue.container.querySelectorAll("button")) expect(button.getAttribute("aria-label")).toBeTruthy();
});
it("sépare les MP, les espaces et les outils d'administration", async () => {
  useAdminStore.setState({ isAdmin: true });
  await vue.render(<RailServeurs />);
  expect(vue.container.querySelector('[aria-label="settings.account"]')).toBeNull();
  expect(vue.container.querySelector('[data-espace="channels"]')).toBeNull();
  const mp = vue.container.querySelector('[data-espace="dm"]')!;
  const ajouter = vue.container.querySelector('[aria-label="spaces.add"]')!;
  const separation = vue.container.querySelector(".sion-barre-espaces-outils > .sion-rail-separation")!;
  const admin = vue.container.querySelector('[aria-label="admin.title"]')!;
  expect(mp.compareDocumentPosition(ajouter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(vue.container.querySelector("button")).toBe(mp);
  expect(mp.compareDocumentPosition(separation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(separation.compareDocumentPosition(admin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("garde l'accès au compte en bas quand la liste et son profil sont masqués", async () => {
  useLayoutStore.setState({ sidebarMode: "hidden" });
  await vue.render(<RailServeurs />);
  const compte = vue.container.querySelector('[aria-label="settings.account"]')!;
  const separation = vue.container.querySelector(".sion-barre-espaces-outils > .sion-rail-separation")!;
  expect(compte).not.toBeNull();
  expect(separation.compareDocumentPosition(compte) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
