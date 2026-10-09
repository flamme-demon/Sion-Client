import { montage } from "../../test/interface";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserEvent } from "matrix-js-sdk";
import { MemberPanel } from "./MemberPanel";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useLiveKitStore } from "../../stores/useLiveKitStore";
import type { Channel, MatrixPresence, VoiceChannelUser } from "../../types/matrix";

const serveur = vi.hoisted(() => ({
  natif: false, presence: "online" as MatrixPresence | undefined,
  membres: undefined as { userId: string; displayName: string; avatarUrl: null; presence?: MatrixPresence }[] | undefined,
  pouvoirs: {} as Record<string, number>,
  textesManquants: false,
  on: vi.fn(), off: vi.fn(), roomOn: vi.fn(), roomOff: vi.fn(), relire: vi.fn(),
}));
const dictionnaire = vi.hoisted(() => ({ exists: vi.fn(() => true), reloadResources: vi.fn().mockResolvedValue(undefined) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options?: { defaultValue?: string }) => serveur.textesManquants ? options?.defaultValue ?? key : key,
  i18n: dictionnaire,
}) }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => serveur.natif }));
vi.mock("../../services/cacheRust", () => ({ oublierDetails: serveur.relire }));
vi.mock("../../services/matrixService", () => ({
  getMatrixClient: () => ({ on: serveur.on, off: serveur.off, getRoom: () => ({ on: serveur.roomOn, off: serveur.roomOff }) }),
  getMemberPowerLevel: (_salon: string, userId: string) => serveur.pouvoirs[userId] ?? 0,
  getRoomMembers: () => serveur.membres ?? [
    { userId: "@alice:hs", displayName: "Alice", avatarUrl: null, presence: serveur.presence },
    { userId: "@bob:hs", displayName: "Bob", avatarUrl: null },
  ],
}));

const vue = montage();
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
  serveur.natif = false;
  serveur.presence = "online";
  serveur.membres = undefined;
  serveur.pouvoirs = {};
  serveur.textesManquants = false;
  dictionnaire.exists.mockReturnValue(true);
  useAppStore.setState({ activeChannel: "!salon", userContextMenu: null, connectedVoiceChannel: null });
  useMatrixStore.setState({ channels: [], pinnedVersion: 0, connectionStatus: "connected" });
  useLiveKitStore.setState({ connected: false, participants: [] });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const badge = () => vue.container.querySelector("[data-presence]");
const groupe = (nom: string) => vue.container.querySelector(`section[aria-label="members.groups.${nom}"]`)!;
const noms = (nom: string) => Array.from(groupe(nom).querySelectorAll("span"))
  .filter((e) => !e.classList.contains("sion-membre-salon"))
  .map((e) => e.textContent).filter((texte) => texte && texte !== "members.presenceUnknown");
const vocal = (id: string, deafened = false, muted = false): VoiceChannelUser => ({
  id: `@${id}:hs`, name: id, role: "user", speaking: false, muted, deafened,
});
const salonVocal = (id: string, voiceUsers: VoiceChannelUser[]): Channel => ({
  id, name: id, hasVoice: true, voiceUsers, createdAt: 0, lastActivity: 0,
});

it("affiche la présence hors vocal et l'actualise depuis les événements Matrix", async () => {
  await vue.render(<MemberPanel />);
  expect(badge()?.getAttribute("aria-label")).toBe("members.groups.online");
  expect(vue.container.querySelectorAll("[data-presence]")).toHaveLength(1);
  const changer = serveur.on.mock.calls.find(([type]) => type === UserEvent.Presence)![1];
  serveur.presence = "unavailable";
  await act(async () => changer());
  expect(badge()?.getAttribute("title")).toBe("members.groups.online");
  serveur.presence = "offline";
  await act(async () => changer());
  expect(badge()?.getAttribute("data-presence")).toBe("offline");
  await vue.render(<></>);
  expect(serveur.off).toHaveBeenCalledWith(UserEvent.Presence, changer);
});

it("ne déduit pas hors ligne d'une présence absente et masque les états pendant une coupure", async () => {
  serveur.presence = undefined;
  await vue.render(<MemberPanel />);
  expect(badge()).toBeNull();
  serveur.presence = "online";
  await act(async () => useMatrixStore.setState({ pinnedVersion: 1 }));
  expect(badge()).not.toBeNull();
  await act(async () => useMatrixStore.setState({ connectionStatus: "reconnecting" }));
  expect(badge()).toBeNull();
});

it("actualise les présences du cœur avec les détails du salon et conserve le clic droit", async () => {
  serveur.natif = true;
  vi.useFakeTimers();
  await vue.render(<MemberPanel />);
  expect(serveur.relire).toHaveBeenCalledWith("!salon");
  serveur.presence = "offline";
  await act(async () => { vi.advanceTimersByTime(15_000); useMatrixStore.setState({ pinnedVersion: 1 }); });
  expect(serveur.relire).toHaveBeenCalledTimes(2);
  expect(badge()?.getAttribute("data-presence")).toBe("offline");
  const nom = Array.from(vue.container.querySelectorAll("span")).find((e) => e.textContent === "Alice")!;
  await act(async () => { nom.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 180, clientY: 120 })); });
  expect(useAppStore.getState().userContextMenu).toEqual({ userId: "@alice:hs", userName: "Alice", x: 180, y: 120 });
  await vue.render(<></>);
  await act(async () => { vi.advanceTimersByTime(15_000); });
  expect(serveur.relire).toHaveBeenCalledTimes(2);
});

it("regroupe par connexion, avec AFK réservé aux membres en vocal et en sourdine", async () => {
  serveur.membres = [
    { userId: "@alice:hs", displayName: "Alice", avatarUrl: null },
    { userId: "@bob:hs", displayName: "Bob", avatarUrl: null, presence: "online" },
    { userId: "@micro:hs", displayName: "Micro coupé", avatarUrl: null, presence: "online" },
    { userId: "@emma:hs", displayName: "Emma", avatarUrl: null, presence: "online" },
    { userId: "@sam:hs", displayName: "Sam", avatarUrl: null, presence: "unavailable" },
    { userId: "@zoe:hs", displayName: "Zoé", avatarUrl: null, presence: "offline" },
    { userId: "@ted:hs", displayName: "Ted", avatarUrl: null },
  ];
  serveur.pouvoirs = { "@alice:hs": 100, "@bob:hs": 50 };
  useMatrixStore.setState({ channels: [
    salonVocal("!autre-salon", [vocal("alice"), vocal("bob", true, true), vocal("micro", false, true), vocal("hors-liste")]),
    salonVocal("!encore-un", [vocal("alice")]),
  ] });
  await vue.render(<MemberPanel />);
  expect(Array.from(vue.container.querySelectorAll("section")).map((e) => e.getAttribute("aria-label")))
    .toEqual(["members.groups.voice", "members.groups.online", "members.groups.afk", "members.groups.offline"]);
  expect(noms("voice")).toEqual(["Alice", "Micro coupé"]);
  expect(noms("online")).toEqual(["Emma", "Sam"]);
  expect(noms("afk")).toEqual(["Bob"]);
  expect(noms("offline")).toEqual(["Ted", "Zoé"]);
  expect(groupe("voice").firstElementChild?.textContent).toBe("members.groups.voice — 2");
  expect(groupe("offline").textContent).toContain("members.presenceUnknown");
  // Retirer la sourdine déplace Bob sans changer sa connexion au vocal.
  await act(async () => useMatrixStore.setState({ channels: [
    salonVocal("!autre-salon", [vocal("alice"), vocal("bob"), vocal("micro", false, true)]),
  ] }));
  expect(noms("voice")).toEqual(["Alice", "Bob", "Micro coupé"]);
  expect(noms("afk")).toEqual([]);
  expect(groupe("afk").firstElementChild?.textContent).toBe("members.groups.afk — 0");
});

it("un appareil à l'écoute suffit pour rester En vocal", async () => {
  const utilisateur = { ...vocal("alice", true), devices: [
    { id: "PC", muted: true, deafened: true, mobile: false },
    { id: "TEL", muted: false, deafened: false, mobile: true },
  ] };
  useMatrixStore.setState({ channels: [salonVocal("!vocal", [utilisateur])] });
  await vue.render(<MemberPanel />);
  expect(noms("voice")).toEqual(["Alice"]);
  expect(noms("afk")).toEqual([]);
  await act(async () => useMatrixStore.setState({ channels: [salonVocal("!vocal", [
    { ...utilisateur, devices: utilisateur.devices.map((d) => ({ ...d, deafened: true })) },
  ])] }));
  expect(noms("voice")).toEqual([]);
  expect(noms("afk")).toEqual(["Alice"]);
});

it("affiche des libellés lisibles et recharge le dictionnaire d'une session déjà ouverte", async () => {
  serveur.textesManquants = true;
  dictionnaire.exists.mockReturnValue(false);
  await vue.render(<MemberPanel />);
  expect(dictionnaire.reloadResources).toHaveBeenCalledOnce();
  expect(Array.from(vue.container.querySelectorAll("section")).map((e) => e.getAttribute("aria-label")))
    .toEqual(["En vocal", "En ligne", "AFK", "Hors ligne"]);
  expect(vue.container.textContent).not.toContain("members.");
  expect(vue.container.textContent).toContain("Présence inconnue");
});

it("le vocal et les AFK ont un point vert, leur indicateur et le nom de leurs salons", async () => {
  serveur.presence = undefined;
  useMatrixStore.setState({ channels: [
    { ...salonVocal("!un", [vocal("alice"), vocal("bob", true)]), name: "Général" },
    { ...salonVocal("!deux", [vocal("alice")]), name: "Détente" },
  ] });
  await vue.render(<MemberPanel />);
  expect(groupe("voice").querySelector("[data-presence]")?.getAttribute("data-presence")).toBe("online");
  expect(groupe("afk").querySelector("[data-presence]")?.getAttribute("data-presence")).toBe("online");
  expect(groupe("voice").querySelector(".sion-membre-salon")?.textContent).toBe("Général, Détente");
  expect(groupe("afk").querySelector(".sion-membre-salon")?.textContent).toBe("Général");
  expect(groupe("afk").querySelector(".sion-membre-afk svg")).not.toBeNull();
  expect(groupe("voice").querySelector(".sion-membre-onde--parle")).toBeNull();
  await act(async () => useAppStore.setState({ connectedVoiceChannel: "!un" }));
  await act(async () => useLiveKitStore.setState({ connected: true, participants: [{
    identity: "@alice:hs:PC", name: "Alice", isSpeaking: true, isMuted: false, isDeafened: false,
    isScreenSharing: false, audioLevel: 0.5, connectionQuality: "excellent",
  }] }));
  expect(groupe("voice").querySelector(".sion-membre-onde--parle")).not.toBeNull();
  await act(async () => useLiveKitStore.setState({ participants: useLiveKitStore.getState().participants.map((p) => ({ ...p, isMuted: true })) }));
  expect(groupe("voice").querySelector(".sion-membre-onde--parle")).toBeNull();
});
