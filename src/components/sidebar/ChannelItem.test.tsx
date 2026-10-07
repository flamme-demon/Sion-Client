import { montage } from "../../test/interface";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelItem } from "./ChannelItem";
import { useAppStore } from "../../stores/useAppStore";
import { useLiveKitStore } from "../../stores/useLiveKitStore";
import type { Channel } from "../../types/matrix";

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("../../hooks/useVoiceChannel", () => ({ useVoiceChannel: () => ({ joinVoiceChannel: vi.fn(), hasLiveKitConfig: false }) }));
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
});
afterEach(() => vi.useRealTimers());

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
