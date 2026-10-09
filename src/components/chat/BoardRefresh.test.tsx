import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { SoundboardPanel } from "./SoundboardPanel";
import { MemeboardPanel } from "./MemeboardPanel";

const services = vi.hoisted(() => ({ trouver: vi.fn(), sons: vi.fn(), memes: vi.fn() }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => false }));
vi.mock("../../services/matrixService", () => ({ getMatrixClient: () => null, findSoundboardRoom: services.trouver, canSendMessage: () => false }));
vi.mock("../../services/soundboardHotkeys", () => ({ loadHotkeys: () => ({}), onHotkeysChange: () => () => {}, resyncHotkeys: vi.fn(), pruneHotkeys: vi.fn() }));
vi.mock("../../services/soundboardService", () => ({ getSoundboardRoomId: services.trouver, listSounds: services.sons, setPlaybackVolume: vi.fn() }));
vi.mock("../../services/memeboardService", () => ({ listMemes: services.memes }));
vi.mock("./VoicePanel", () => ({ VoicePanel: () => null }));
vi.mock("./SoundboardUploadModal", () => ({ SoundboardUploadModal: () => null }));
vi.mock("./HotkeyCaptureModal", () => ({ HotkeyCaptureModal: () => null }));
const vue = montage();
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); services.sons.mockResolvedValue([]); services.memes.mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());

it.each([SoundboardPanel, MemeboardPanel])("%s regroupe les demandes lentes et les abandonne après fermeture", async (Panneau) => {
  let terminer!: (id: string) => void;
  services.trouver.mockReturnValue(new Promise((resolve) => { terminer = resolve; }));
  await vue.render(<Panneau />);
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(services.trouver).toHaveBeenCalledOnce();
  await vue.render(null);
  await act(async () => { terminer("!board"); });
  expect(services.trouver).toHaveBeenCalledOnce();
  expect(services.sons).not.toHaveBeenCalled();
  expect(services.memes).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
