import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PanneauLateral } from "./PanneauLateral";
import { useLayoutStore } from "../../stores/useLayoutStore";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./panneaux", () => ({
  PANNEAU_TITRES: { soundboard: "soundboard.title", members: "members.title" },
  PANNEAU_CORPS: { soundboard: () => <div>Sons</div>, members: () => <div>Membres</div> },
  PANNEAU_COMPTEURS: {},
}));
const vue = montage();
beforeEach(() => useLayoutStore.setState({ panneau: null, largeurPanneau: 360 }));
it("n'affiche rien sans panneau ouvert", async () => {
  await vue.render(<PanneauLateral />);
  expect(vue.container.childElementCount).toBe(0);
});
it("affiche le titre et un seul bouton Fermer", async () => {
  useLayoutStore.setState({ panneau: "soundboard" });
  await vue.render(<PanneauLateral />);
  expect(vue.container.textContent).toContain("soundboard.title");
  expect(vue.container.querySelectorAll('[aria-label="chat.close"]')).toHaveLength(1);
  await vue.click('[aria-label="chat.close"]');
  expect(useLayoutStore.getState().panneau).toBeNull();
});
it("redimensionne au clavier et ferme avec Échap depuis le corps", async () => {
  useLayoutStore.setState({ panneau: "members" });
  await vue.render(<PanneauLateral />);
  await act(async () => vue.container.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(useLayoutStore.getState().largeurPanneau).toBe(368);
  await act(async () => vue.container.querySelector("aside")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(useLayoutStore.getState().panneau).toBeNull();
});
