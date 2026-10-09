import { montage } from "../../test/interface";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SoundboardPanel } from "./SoundboardPanel";
import { PanneauLateral } from "../layout/PanneauLateral";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useLayoutStore } from "../../stores/useLayoutStore";

const services = vi.hoisted(() => ({ deleteSound: vi.fn(), playSoundLocal: vi.fn(), invalidateSoundCache: vi.fn() }));

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string; count?: number; label?: string }) => options?.defaultValue?.replace("{{count}}", String(options.count)) ?? (options?.label ? `${key} ${options.label}` : key) }) }));
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
  setPlaybackVolume: vi.fn(), playSoundLocal: services.playSoundLocal, broadcastSound: vi.fn(), playErrorBuzzer: vi.fn(),
  deleteSound: services.deleteSound, invalidateSoundCache: services.invalidateSoundCache, fetchSoundFile: vi.fn(), SOUNDBOARD_MAX_FILE_SIZE: 100000,
}));
const vue = montage();
beforeEach(() => {
  useSettingsStore.setState({ soundboardView: { mode: "all", category: null }, soundboardPlayCounts: { son1: 2 }, hiddenCategories: [], soundboardEnabled: true });
  services.deleteSound.mockReset().mockResolvedValue(undefined);
  services.playSoundLocal.mockReset();
  services.invalidateSoundCache.mockReset();
});
afterEach(() => vi.restoreAllMocks());
it("Top, Tous et les catégories filtrent les sons et mémorisent le choix", async () => {
  await vue.render(<SoundboardPanel />);
  await vue.click('[data-filter="top"]');
  expect(useSettingsStore.getState().soundboardView.mode).toBe("top");
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(1);
  await vue.click('[data-filter="all"]');
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(2);
  await vue.click('[data-filter="Other"]');
  expect(useSettingsStore.getState().soundboardView).toEqual({ mode: "all", category: "Other" });
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(1);
});
it("migre la vue Favoris vers Top et nettoie le stockage sans perdre les compteurs ou les autres réglages", async () => {
  localStorage.setItem("sion-settings", JSON.stringify({ version: 1, state: {
    soundboardFavorites: ["son1"], soundboardView: { mode: "favorites", category: null },
    soundboardPlayCounts: { son1: 2, son2: 7 }, memeboardPlayCounts: { $meme: 4 },
    soundboardVolume: 0.35, language: "fr", hiddenCategories: ["Films"],
  } }));
  await useSettingsStore.persist.rehydrate();
  await vue.render(<SoundboardPanel />);
  expect(vue.container.querySelector('[data-filter="top"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(2);
  expect(vue.container.querySelector(".sound-card")?.textContent).toContain("Au revoir");
  expect(vue.container.querySelector('[data-filter="fav"]')).toBeNull();
  expect(vue.container.querySelector('[aria-label="soundboard.favorite"], [aria-label="soundboard.unfavorite"]')).toBeNull();
  expect(vue.container.textContent).not.toMatch(/[★☆⭐]/);
  const sauvegarde = JSON.parse(localStorage.getItem("sion-settings")!);
  expect(sauvegarde.version).toBe(2);
  expect(sauvegarde.state).not.toHaveProperty("soundboardFavorites");
  expect(useSettingsStore.getState()).not.toHaveProperty("soundboardFavorites");
  expect(sauvegarde.state).toMatchObject({ soundboardView: { mode: "top", category: null },
    soundboardPlayCounts: { son1: 2, son2: 7 }, memeboardPlayCounts: { $meme: 4 },
    soundboardVolume: 0.35, language: "fr", hiddenCategories: ["Films"],
  });
});
it("conserve le volume en pied et les commandes de lecture", async () => {
  await vue.render(<SoundboardPanel />);
  expect(vue.container.querySelector(".soundboard-panel")?.lastElementChild?.querySelector('[aria-label="soundboard.volume"]')).not.toBeNull();
  await vue.click(".sound-card");
  expect(services.playSoundLocal).toHaveBeenCalledWith("mxc://s/1", undefined);
});
it("le filtre compact utilise les mêmes catégories et compteurs que les pilules", async () => {
  await vue.render(<SoundboardPanel />);
  const select = vue.container.querySelector<HTMLSelectElement>(".sion-board-filtre-compact")!;
  await act(async () => { select.value = "top"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(1);
  expect(useSettingsStore.getState().soundboardView).toEqual({ mode: "top", category: null });
  await act(async () => { select.value = "category:Other"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(vue.container.querySelectorAll(".sound-card")).toHaveLength(1);
  expect(vue.container.querySelector(".sound-card")?.textContent).toContain("Au revoir");
  expect(useSettingsStore.getState().soundboardView).toEqual({ mode: "all", category: "Other" });
  await act(async () => select.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(useSettingsStore.getState().hiddenCategories).toContain("Other");
});
it("le panneau réel ne double pas la fermeture et publie son total", async () => {
  useLayoutStore.getState().ouvrirPanneau("soundboard");
  await vue.render(<PanneauLateral />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(vue.container.querySelectorAll('[aria-label="chat.close"]')).toHaveLength(1);
  expect(vue.container.querySelectorAll('[title="soundboard.close"]')).toHaveLength(0);
  expect(vue.container.querySelector(".sion-panneau-entete")?.textContent).toContain("2 sons");
});
it("confirme la suppression dans Sion, sans dialogue système ni lecture du son", async () => {
  const native = vi.spyOn(window, "confirm").mockReturnValue(true);
  await vue.render(<SoundboardPanel />);
  await vue.click('.sound-card [data-action="supprimer"]');
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Bonjour");
  expect(services.deleteSound).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('[data-action="annuler-suppression"]')!.click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(services.deleteSound).not.toHaveBeenCalled();
  await vue.click('.sound-card [data-action="supprimer"]');
  await act(async () => document.querySelector<HTMLButtonElement>('[data-action="confirmer-suppression"]')!.click());
  expect(services.deleteSound).toHaveBeenCalledExactlyOnceWith("son1");
  expect(services.invalidateSoundCache).toHaveBeenCalledWith("mxc://s/1");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(services.playSoundLocal).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});
