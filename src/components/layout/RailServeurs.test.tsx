import { montage } from "../../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { RailServeurs } from "./RailServeurs";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useAdminStore } from "../../stores/useAdminStore";
import { act } from "react";

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../sidebar/AccountPopover", () => ({ AccountPopover: () => null }));
vi.mock("../../services/lazyScreens", () => ({ preloadHeavyScreens: vi.fn() }));
vi.mock("../../hooks/useFenetreEtroite", () => ({ useFenetreEtroite: () => false }));
const vue = montage();
beforeEach(() => { useLayoutStore.setState({ sidebarMode: "full" }); useAdminStore.setState({ isAdmin: false }); });
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
