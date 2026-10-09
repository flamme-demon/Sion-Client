import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { MobilePanelSheet } from "./MobilePanelSheet";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../layout/panneaux", () => ({
  PANNEAU_TITRES: { soundboard: "soundboard.title", memeboard: "memeboard.title" },
  PANNEAU_CORPS: { soundboard: () => <div>Sons</div>, memeboard: () => <div>Memes</div> },
}));
const vue = montage();
beforeEach(() => useLayoutStore.setState({ panneau: null, panneaux: [], positionsPanneaux: {} }));

it("affiche une seule feuille et conserve les autres modules du bureau à sa fermeture", async () => {
  useLayoutStore.getState().ouvrirPanneau("soundboard");
  useLayoutStore.getState().deplacerPanneau("soundboard", "left");
  useLayoutStore.getState().ouvrirPanneau("memeboard");
  await vue.render(<MobilePanelSheet />);
  expect(vue.container.textContent).toContain("Memes");
  expect(vue.container.textContent).not.toContain("Sons");
  await vue.click("[data-fermer-panneau]");
  expect(vue.container.childElementCount).toBe(0);
  expect(useLayoutStore.getState().panneaux).toEqual(["soundboard"]);
  expect(useLayoutStore.getState().positionsPanneaux.soundboard).toBe("left");
  await act(async () => useLayoutStore.getState().ouvrirPanneau("soundboard"));
  expect(vue.container.textContent).toContain("Sons");
  expect(useLayoutStore.getState().panneaux).toEqual(["soundboard"]);
});

it("basculer entre les feuilles ne change pas les positions du bureau", async () => {
  useLayoutStore.getState().ouvrirPanneau("soundboard");
  useLayoutStore.getState().ouvrirPanneau("memeboard");
  useLayoutStore.getState().deplacerPanneau("memeboard", "bottom");
  await vue.render(<MobilePanelSheet />);
  await act(async () => useLayoutStore.getState().ouvrirPanneau("soundboard"));
  expect(vue.container.textContent).toContain("Sons");
  expect(vue.container.textContent).not.toContain("Memes");
  expect(useLayoutStore.getState().panneaux).toEqual(["soundboard", "memeboard"]);
  expect(useLayoutStore.getState().positionsPanneaux.memeboard).toBe("bottom");
});
