import { montage } from "../../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { RailServeurs } from "./RailServeurs";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useAdminStore } from "../../stores/useAdminStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { act } from "react";

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../sidebar/AccountPopover", () => ({ AccountPopover: () => null }));
vi.mock("../../services/lazyScreens", () => ({ preloadHeavyScreens: vi.fn() }));
vi.mock("../../hooks/useFenetreEtroite", () => ({ useFenetreEtroite: () => false }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => null }));
const vue = montage();
beforeEach(() => {
  useLayoutStore.setState({ sidebarMode: "full" });
  useAdminStore.setState({ isAdmin: false });
  useSettingsStore.setState({ sidebarView: "channels" });
  useMatrixStore.setState({ channels: [], messages: {} });
});
it("le logo replie et déplie la barre des salons", async () => {
  await vue.render(<RailServeurs />);
  await vue.click('[aria-label="layout.toggleSidebar"]');
  expect(useLayoutStore.getState().sidebarMode).toBe("rail");
});
it("ne montre Administration qu'aux admins", async () => {
  await vue.render(<RailServeurs />);
  expect(vue.container.querySelector('[aria-label="admin.title"]')).toBeNull();
  await act(async () => useAdminStore.setState({ isAdmin: true }));
  await vue.render(<RailServeurs />);
  expect(vue.container.querySelector('[aria-label="admin.title"]')).not.toBeNull();
});
it("chaque bouton a un nom accessible", async () => {
  await vue.render(<RailServeurs />);
  for (const button of vue.container.querySelectorAll("button")) expect(button.getAttribute("aria-label")).toBeTruthy();
});
it("remplace l'avatar du haut par Serveur / MP et range l'administration en bas", async () => {
  useAdminStore.setState({ isAdmin: true });
  await vue.render(<RailServeurs />);
  expect(vue.container.querySelector('[aria-label="settings.account"]')).toBeNull();
  const serveur = vue.container.querySelector('[data-espace="channels"]')!;
  const mp = vue.container.querySelector('[data-espace="dm"]')!;
  const separation = vue.container.querySelector(".sion-rail > .sion-rail-separation")!;
  const admin = vue.container.querySelector('[aria-label="admin.title"]')!;
  expect(mp.compareDocumentPosition(serveur) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(vue.container.querySelector("button")).toBe(mp);
  expect(mp.compareDocumentPosition(separation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(separation.compareDocumentPosition(admin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("garde l'accès au compte en bas quand la liste et son profil sont masqués", async () => {
  useLayoutStore.setState({ sidebarMode: "hidden" });
  await vue.render(<RailServeurs />);
  const compte = vue.container.querySelector('[aria-label="settings.account"]')!;
  const separation = vue.container.querySelector(".sion-rail > .sion-rail-separation")!;
  expect(compte).not.toBeNull();
  expect(separation.compareDocumentPosition(compte) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
