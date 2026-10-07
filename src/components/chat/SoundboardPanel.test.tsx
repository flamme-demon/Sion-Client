import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { SoundboardPanel } from "./SoundboardPanel";
import { PanneauLateral } from "../layout/PanneauLateral";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useLayoutStore } from "../../stores/useLayoutStore";

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => false }));
vi.mock("../../services/matrixService", () => ({ canSendMessage: () => true, getMatrixClient: () => null, getMemberPowerLevel: () => 100, getRoomMembers: () => [] }));
vi.mock("./SoundboardUploadModal", () => ({ SoundboardUploadModal: () => null }));
vi.mock("./VoicePanel", () => ({ VoicePanel: () => null }));
vi.mock("./HotkeyCaptureModal", () => ({ HotkeyCaptureModal: () => null }));
vi.mock("../../services/soundboardHotkeys", () => ({ loadHotkeys: () => ({}), onHotkeysChange: () => () => {}, pruneHotkeys: vi.fn(), resyncHotkeys: vi.fn() }));
vi.mock("../../services/soundboardService", () => ({
  getSoundboardRoomId: async () => "!sons",
  listSounds: async () => [
    { eventId: "son1", label: "Bonjour", emoji: "👋", category: "Music", mxcUrl: "mxc://s/1", duration: 1000 },
    { eventId: "son2", label: "Au revoir", emoji: "✋", category: "Other", mxcUrl: "mxc://s/2", duration: 1000 },
  ],
  setPlaybackVolume: vi.fn(), playSoundLocal: vi.fn(), broadcastSound: vi.fn(), playErrorBuzzer: vi.fn(),
  deleteSound: vi.fn(), invalidateSoundCache: vi.fn(), fetchSoundFile: vi.fn(), SOUNDBOARD_MAX_FILE_SIZE: 100000,
}));
const vue = montage();
beforeEach(() => useSettingsStore.setState({ soundboardView: { mode: "all", category: null }, soundboardFavorites: ["son1"], hiddenCategories: [], soundboardEnabled: true }));
it("Favoris, Top, Tous et les catégories filtrent les sons et mémorisent le choix", async () => {
  await vue.render(<SoundboardPanel />);
  await vue.click('[data-filter="fav"]');
  expect(useSettingsStore.getState().soundboardView.mode).toBe("favorites");
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(1);
  await vue.click('[data-filter="top"]');
  expect(useSettingsStore.getState().soundboardView.mode).toBe("top");
  await vue.click('[data-filter="all"]');
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(2);
  await vue.click('[data-filter="Other"]');
  expect(useSettingsStore.getState().soundboardView).toEqual({ mode: "all", category: "Other" });
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(1);
});
it("présente deux colonnes et le volume en pied", async () => {
  await vue.render(<SoundboardPanel />);
  expect((vue.container.querySelector(".soundboard-grid") as HTMLElement).style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  expect(vue.container.querySelector(".soundboard-panel")?.lastElementChild?.querySelector('[aria-label="soundboard.volume"]')).not.toBeNull();
});
it("le panneau réel ne double pas la fermeture et publie son total", async () => {
  useLayoutStore.setState({ panneau: "soundboard" });
  await vue.render(<PanneauLateral />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(vue.container.querySelectorAll('[aria-label="chat.close"]')).toHaveLength(1);
  expect(vue.container.querySelectorAll('[title="soundboard.close"]')).toHaveLength(0);
  expect(vue.container.querySelector(".sion-panneau-entete")?.textContent).toContain("2");
});
