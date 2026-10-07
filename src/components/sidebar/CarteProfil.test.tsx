import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { CarteProfil } from "./CarteProfil";
import { useAppStore } from "../../stores/useAppStore";
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const quitter = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/useVoiceChannel", () => ({ useVoiceChannel: () => ({ leaveVoiceChannel: quitter }), republishVoicePresence: vi.fn() }));
vi.mock("../../hooks/useLatence", () => ({ useLatence: () => null }));
vi.mock("./CarteReconnexion", () => ({ CarteReconnexion: () => null }));
vi.mock("../../services/lazyScreens", () => ({ preloadHeavyScreens: vi.fn() }));
const vue = montage();
beforeEach(() => { useAppStore.setState({ connectedVoiceChannel: null, isMuted: false, isDeafened: false, clockSkewMin: 0, e2eeUnhealthy: false }); quitter.mockClear(); });
it("raccrocher n'apparaît qu'en appel et quitte le bon salon", async () => {
  await vue.render(<CarteProfil compact={false} />);
  expect(vue.container.querySelector('[aria-label="voice.disconnect"]')).toBeNull();
  await act(async () => useAppStore.setState({ connectedVoiceChannel: "!salon" }));
  await vue.click('[aria-label="voice.disconnect"]');
  expect(quitter).toHaveBeenCalledWith("!salon");
});
it("micro et casque reflètent et basculent l'état", async () => {
  await vue.render(<CarteProfil compact={false} />);
  await vue.click('[aria-label="controls.mute"]');
  expect(useAppStore.getState().isMuted).toBe(true);
  expect(vue.container.querySelector('[aria-label="controls.unmute"]')?.getAttribute("aria-pressed")).toBe("true");
  await vue.click('[aria-label="controls.deafen"]');
  expect(useAppStore.getState().isDeafened).toBe(true);
});
it("en rail, seuls l'avatar et raccrocher restent", async () => {
  useAppStore.setState({ connectedVoiceChannel: "!salon" });
  await vue.render(<CarteProfil compact />);
  expect(vue.container.querySelectorAll("button")).toHaveLength(2);
  expect(vue.container.querySelector('[aria-label="voice.disconnect"]')).not.toBeNull();
});
