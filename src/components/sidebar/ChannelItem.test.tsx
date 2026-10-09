import { montage } from "../../test/interface";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelItem } from "./ChannelItem";
import { useAppStore } from "../../stores/useAppStore";
import { useLiveKitStore } from "../../stores/useLiveKitStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import type { Channel } from "../../types/matrix";

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
const depart = vi.hoisted(() => ({ quitter: vi.fn(), vocal: vi.fn() }));
vi.mock("../../services/quitterSalon", () => ({ quitterSalon: depart.quitter }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string, options?: { defaultValue?: string }) => options?.defaultValue ?? cle }) }));
vi.mock("../../hooks/useVoiceChannel", () => ({ useVoiceChannel: () => ({ joinVoiceChannel: vi.fn(), leaveVoiceChannel: depart.vocal, hasLiveKitConfig: false }) }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => null }));
vi.mock("../../services/matrixService", () => ({ getMatrixClient: () => null }));
vi.mock("./ChannelIcon", () => ({ ChannelIcon: () => <span>#</span> }));
vi.mock("./UserAvatar", () => ({ UserAvatar: () => <span>Avatar</span> }));

const vue = montage();
const salon: Channel = {
  id: "!vocal", name: "Vocal", hasVoice: true, createdAt: 0, lastActivity: 0,
  voiceUsers: [{ id: "@alice:sion.test", name: "Alice", role: "user", speaking: false, muted: true, deafened: false }],
};
const survol = async (element: Element, type: "mouseover" | "mouseout", relatedTarget: Element | null = null) => {
  await act(async () => { element.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget })); });
};
const attendre = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ activeChannel: "", connectedVoiceChannel: null, userContextMenu: null });
  useLiveKitStore.setState({ connected: false, participants: [] });
  useMatrixStore.setState({ currentUserId: "@membre:sion.test" });
  depart.quitter.mockReset().mockResolvedValue(undefined);
  depart.vocal.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("la carte des occupants sort de la bulle isolée et reste ouverte au passage de la souris", async () => {
  await vue.render(<nav style={{ isolation: "isolate", overflow: "hidden" }}><ChannelItem channel={salon} compact /></nav>);
  const bouton = vue.container.querySelector("button")!;
  await survol(bouton, "mouseover");
  await attendre(140);
  const carte = document.querySelector(".sion-survol-salon")!;
  expect(carte?.textContent).toContain("Alice");
  expect(vue.container.contains(carte)).toBe(false);
  await survol(bouton, "mouseout", carte);
  await survol(carte, "mouseover", bouton);
  await attendre(300);
  expect(document.querySelector(".sion-survol-salon")).toBe(carte);
  await survol(carte, "mouseout");
  await attendre(240);
  expect(document.querySelector(".sion-survol-salon")).toBeNull();
});

it("le clic droit d'un occupant ouvre toujours son menu depuis la carte", async () => {
  await vue.render(<ChannelItem channel={salon} compact />);
  await survol(vue.container.querySelector("button")!, "mouseover");
  await attendre(140);
  const nom = Array.from(document.querySelectorAll(".sion-survol-salon span")).find((span) => span.textContent === "Alice")!;
  // Dépasser la garde de 800 ms contre le clic synthétique d'un appui long.
  await attendre(1000);
  await act(async () => { nom.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 180, clientY: 120 })); });
  expect(useAppStore.getState().userContextMenu).toEqual({ userId: "@alice:sion.test", userName: "Alice", x: 180, y: 120 });
});

const menuSalon = async () => {
  await attendre(1000);
  await act(async () => vue.container.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 180, clientY: 120 })));
  return document.querySelector<HTMLElement>('[role="menu"]')!;
};
const ouvrirConfirmation = async () => {
  const menu = await menuSalon();
  await act(async () => menu.querySelector<HTMLButtonElement>("button")!.click());
  return document.querySelector<HTMLElement>('[role="alertdialog"]')!;
};

it.each([
  { ...salon, hasVoice: false, voiceUsers: [] },
  salon,
  { ...salon, isDM: true, hasVoice: false, voiceUsers: [] },
])("un membre peut quitter $name (vocal : $hasVoice, MP : $isDM) depuis un menu au-dessus des bulles", async (channel) => {
  await vue.render(<nav style={{ isolation: "isolate", overflow: "hidden" }}><ChannelItem channel={channel} compact /></nav>);
  const menu = await menuSalon();
  expect(menu.textContent).toContain(channel.isDM ? "Quitter cette conversation" : "Quitter le salon");
  expect(vue.container.contains(menu)).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector("button"));
  await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(vue.container.querySelector("button"));
  expect(depart.quitter).not.toHaveBeenCalled();
});

it("la confirmation Sion permet d'annuler sans quitter le salon ni le vocal", async () => {
  await vue.render(<ChannelItem channel={salon} />);
  const dialogue = await ouvrirConfirmation();
  expect(vue.container.contains(dialogue)).toBe(false);
  expect(depart.quitter).not.toHaveBeenCalled();
  await act(async () => dialogue.querySelector<HTMLButtonElement>('[data-action="annuler-depart"]')!.click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(depart.quitter).not.toHaveBeenCalled();
  expect(depart.vocal).not.toHaveBeenCalled();
});

it("quitte d'abord l'appel de ce salon et empêche les doubles départs", async () => {
  let terminerVocal!: () => void;
  depart.vocal.mockImplementation(() => new Promise<void>((resolve) => { terminerVocal = resolve; }));
  useAppStore.setState({ connectedVoiceChannel: salon.id });
  await vue.render(<ChannelItem channel={salon} />);
  const dialogue = await ouvrirConfirmation();
  expect(dialogue.textContent).toContain("déconnecté de son appel vocal");
  const confirmer = dialogue.querySelector<HTMLButtonElement>('[data-action="confirmer-depart"]')!;
  await act(async () => { confirmer.click(); confirmer.click(); });
  expect(depart.vocal).toHaveBeenCalledExactlyOnceWith(salon.id);
  expect(depart.quitter).not.toHaveBeenCalled();
  expect(dialogue.getAttribute("aria-busy")).toBe("true");
  await act(async () => dialogue.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="alertdialog"]')).toBe(dialogue);
  await act(async () => terminerVocal());
  expect(depart.quitter).toHaveBeenCalledExactlyOnceWith(salon);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("laisse l'appel d'un autre salon ouvert et affiche une erreur avec possibilité de réessayer", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  depart.quitter.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  useAppStore.setState({ connectedVoiceChannel: "!autre-vocal" });
  await vue.render(<ChannelItem channel={salon} />);
  const dialogue = await ouvrirConfirmation();
  const confirmer = dialogue.querySelector<HTMLButtonElement>('[data-action="confirmer-depart"]')!;
  await act(async () => confirmer.click());
  expect(depart.vocal).not.toHaveBeenCalled();
  expect(dialogue.querySelector('[role="alert"]')?.textContent).toContain("Impossible de quitter");
  expect(confirmer.disabled).toBe(false);
  await act(async () => confirmer.click());
  expect(depart.quitter).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
