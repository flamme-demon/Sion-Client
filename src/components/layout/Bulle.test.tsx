import { montage } from "../../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { Bulle } from "./Bulle";
import { useLayoutStore } from "../../stores/useLayoutStore";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../services/panelBackground", () => ({
  usePanelBackgroundUrl: () => "/fond.webp",
  bgAnchorCss: () => "center",
  pickPanelBackground: vi.fn(),
}));

const vue = montage();
beforeEach(() => {
  useLayoutStore.setState({ panelBackgrounds: {} });
});

it("rend un contenant arrondi avec la balise demandée", async () => {
  await vue.render(<Bulle as="nav" aria-label="Salons">Contenu</Bulle>);
  const container = vue.container;
  expect(container.firstElementChild?.tagName).toBe("NAV");
  expect(container.firstElementChild?.classList.contains("sion-bulle")).toBe(true);
  expect(container.firstElementChild?.getAttribute("aria-label")).toBe("Salons");
  await vue.render(<Bulle>Contenu</Bulle>);
  expect(container.firstElementChild?.tagName).toBe("SECTION");
});

it("pose le fond d'image de sa portée sous le contenu", async () => {
  useLayoutStore.setState({ panelBackgrounds: { chat: { path: "/fond.webp", opacity: 0.5 } } });
  await vue.render(<Bulle scope="chat">Conversation</Bulle>);
  const container = vue.container;
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/fond.webp");
  expect((container.firstElementChild as HTMLElement).style.isolation).toBe("isolate");
});
