import "../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { quitterEspace, EchecDepartEspace } from "./quitterEspace";
import { useAppStore } from "../stores/useAppStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import type { Channel } from "../types/matrix";
import { contexteBibliotheque } from "../utils/bibliotheque";
const appels = vi.hoisted(() => ({ leave: vi.fn(), vocal: vi.fn(), attendre: vi.fn(), arreter: vi.fn() }));
vi.mock("../hooks/useVoiceChannel", () => ({ attendreConnexionsVocales: appels.attendre }));
vi.mock("../i18n", () => ({ default: { t: (cle: string) => cle, changeLanguage: vi.fn() } }));
vi.mock("./matrixService", () => ({ leaveRoom: appels.leave, getMatrixClient: () => null }));
vi.mock("./moteur", () => ({ moteurRust: () => true }));
vi.mock("./reconnexionVocale", () => ({ arreterReconnexion: appels.arreter }));
const salon = (id: string, reste: Partial<Channel> = {}): Channel => ({
  id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...reste,
});
const channels = [salon("!A", { isSpace: true, spaceChildren: ["!texte", "!vocal", "!partage", "!mp"], boardRoomId: "!board" }),
  salon("!B", { isSpace: true, spaceChildren: ["!partage"] }), salon("!texte"),
  salon("!vocal", { hasVoice: true }), salon("!partage"), salon("!mp", { isDM: true }), salon("!board", { isSoundboard: true })];
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  appels.leave.mockReset().mockResolvedValue(undefined);
  appels.vocal.mockReset().mockImplementation(async () => useAppStore.setState({ connectedVoiceChannel: null, connectingVoiceChannel: null }));
  appels.attendre.mockReset().mockResolvedValue(undefined);
  useMatrixStore.setState({ currentUserId: "@alice:hs", channels });
  useEspacesStore.setState({ utilisateur: "@alice:hs", espaceActif: "!A", fenetre: "gerer", salonsQuittes: [], hierarchies: {}, derniersSalons: {}, espaceVocalConserve: null });
  useAppStore.setState({ activeChannel: "!texte", connectedVoiceChannel: "!vocal", connectingVoiceChannel: null,
    pendingAutoJoinVoice: "!vocal", reconnexionVocale: null });
  useSettingsStore.setState({ sidebarView: "channels", defaultChannel: "!vocal", autoJoinVoice: true });
});
const ids = () => appels.leave.mock.calls.map((a) => a[0]);
it("quitte les salons choisis et la bibliothèque avant l'espace, raccroche et annule le vocal automatique", async () => {
  await quitterEspace("!A", ["!texte", "!vocal", "!board", "!mp", "!ailleurs"], appels.vocal);
  expect(ids()).toEqual(["!texte", "!vocal", "!board", "!A"]);
  expect(appels.vocal).toHaveBeenCalledExactlyOnceWith("!vocal");
  expect(appels.vocal.mock.invocationCallOrder[0]).toBeLessThan(appels.leave.mock.invocationCallOrder[1]);
  expect(useMatrixStore.getState().channels.map((c) => c.id)).toEqual(["!B", "!partage", "!mp"]);
  expect(useAppStore.getState().pendingAutoJoinVoice).toBeNull();
  expect(useSettingsStore.getState().defaultChannel).toBe("");
  expect(useSettingsStore.getState().autoJoinVoice).toBe(false);
  expect(useEspacesStore.getState().espaceActif).toBeNull();
  expect(useEspacesStore.getState().fenetre).toBeNull();
});
it("quitter seulement l'espace conserve les salons, la bibliothèque et l'appel", async () => {
  await quitterEspace("!A", [], appels.vocal);
  expect(ids()).toEqual(["!A"]);
  expect(appels.vocal).not.toHaveBeenCalled();
  expect(useMatrixStore.getState().channels.map((c) => c.id)).toEqual(channels.slice(1).map((c) => c.id));
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
  expect(useSettingsStore.getState().defaultChannel).toBe("!vocal");
  const etat = useEspacesStore.getState();
  expect(contexteBibliotheque(useMatrixStore.getState().channels, null, "!vocal", etat.hierarchies, etat.espaceVocalConserve).espaceId).toBe("!A");
  useAppStore.getState().disconnectVoice();
  expect(useEspacesStore.getState().espaceVocalConserve).toBeNull();
});
it("un salon partagé ne peut être quitté que s'il a été explicitement choisi comme tel", async () => {
  await quitterEspace("!A", ["!partage"], appels.vocal);
  expect(ids()).toEqual(["!A"]);
});
it("permet de quitter explicitement un salon partagé", async () => {
  await quitterEspace("!A", ["!partage"], appels.vocal, ["!partage"]);
  expect(ids()).toEqual(["!partage", "!A"]);
});
it("un échec partiel conserve l'espace et permet de reprendre les seuls salons restants", async () => {
  appels.leave.mockImplementation(async (id) => { if (id === "!vocal") throw new Error("hors ligne"); });
  await expect(quitterEspace("!A", ["!texte", "!vocal", "!board"], appels.vocal)).rejects.toMatchObject({ salons: [{ id: "!vocal" }] });
  expect(ids()).toEqual(["!texte", "!vocal", "!board"]);
  expect(useMatrixStore.getState().channels.some((c) => c.id === "!A")).toBe(true);
  expect(useEspacesStore.getState().salonsQuittes).toEqual(["!texte", "!board"]);
  appels.leave.mockResolvedValue(undefined);
  await quitterEspace("!A", ["!texte", "!vocal", "!board"], appels.vocal);
  expect(ids()).toEqual(["!texte", "!vocal", "!board", "!vocal", "!A"]);
});
it("si l'espace lui-même ne peut être quitté, les départs de salons réussis restent acquis", async () => {
  appels.leave.mockImplementation(async (id) => { if (id === "!A") throw new Error("hors ligne"); });
  await expect(quitterEspace("!A", ["!texte"], appels.vocal)).rejects.toBeInstanceOf(EchecDepartEspace);
  expect(useMatrixStore.getState().channels.some((c) => c.id === "!texte")).toBe(false);
  expect(useEspacesStore.getState().espaceActif).toBe("!A");
});
it("arrête la reconnexion concernée sans couper un vocal d'un autre espace", async () => {
  useAppStore.setState({ connectedVoiceChannel: "!autre-vocal", reconnexionVocale: { salon: "!vocal", essai: 1 } });
  await quitterEspace("!A", ["!vocal"], appels.vocal);
  expect(appels.arreter).toHaveBeenCalledOnce();
  expect(appels.vocal).not.toHaveBeenCalled();
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!autre-vocal");
});
it("ne poursuit pas les départs si le compte change pendant une requête", async () => {
  let terminer!: () => void;
  appels.leave.mockImplementationOnce(() => new Promise<void>((resolve) => { terminer = resolve; }));
  const depart = quitterEspace("!A", ["!texte", "!vocal", "!board"], appels.vocal);
  useMatrixStore.setState({ currentUserId: "@bob:hs", channels: [salon("!nouveau")] });
  useAppStore.setState({ activeChannel: "!nouveau" });
  terminer(); await depart;
  expect(ids()).toEqual(["!texte"]);
  expect(useMatrixStore.getState().channels.map((c) => c.id)).toEqual(["!nouveau"]);
});
it("ne détourne pas une navigation effectuée pendant le départ", async () => {
  appels.leave.mockImplementation(async (id) => { if (id === "!A") useEspacesStore.getState().choisir("!B"); });
  await quitterEspace("!A", ["!texte"], appels.vocal);
  expect(useEspacesStore.getState().espaceActif).toBe("!B");
});
it("attend une entrée en vocal en cours et raccroche avant de quitter le salon", async () => {
  useAppStore.setState({ connectedVoiceChannel: null, connectingVoiceChannel: "!vocal" });
  appels.attendre.mockImplementation(async () => useAppStore.setState({ connectedVoiceChannel: "!vocal", connectingVoiceChannel: null }));
  await quitterEspace("!A", ["!vocal"], appels.vocal);
  expect(appels.attendre).toHaveBeenCalledOnce();
  expect(appels.vocal).toHaveBeenCalledExactlyOnceWith("!vocal");
  expect(appels.vocal.mock.invocationCallOrder[0]).toBeLessThan(appels.leave.mock.invocationCallOrder[0]);
  expect(useAppStore.getState().connectedVoiceChannel).toBeNull();
});
it("préserve un salon devenu partagé pendant le départ sans modifier la sélection des autres", async () => {
  appels.leave.mockImplementation(async (id) => {
    if (id === "!texte") useMatrixStore.setState({ channels: useMatrixStore.getState().channels.map((c) =>
      c.id === "!B" ? { ...c, spaceChildren: ["!partage", "!vocal"] } : c) });
  });
  await quitterEspace("!A", ["!texte", "!vocal"], appels.vocal);
  expect(ids()).toEqual(["!texte", "!A"]);
  expect(appels.vocal).not.toHaveBeenCalled();
});
