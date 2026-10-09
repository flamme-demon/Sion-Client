// @vitest-environment jsdom
import "../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { quitterSalon } from "./quitterSalon";
import { useAppStore } from "../stores/useAppStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import type { Channel } from "../types/matrix";

const appel = vi.hoisted(() => ({ rust: true, leave: vi.fn(), donnees: vi.fn(), enregistrer: vi.fn() }));
vi.mock("../i18n", () => ({ default: { t: (cle: string) => cle, changeLanguage: vi.fn() } }));
vi.mock("./moteur", () => ({ moteurRust: () => appel.rust }));
vi.mock("./matrixService", () => ({ leaveRoom: appel.leave, getMatrixClient: () => ({ getAccountData: appel.donnees, setAccountData: appel.enregistrer }) }));
const salon = (id: string, supplement: Partial<Channel> = {}): Channel => ({
  id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...supplement,
});
const equipe = salon("!equipe", { isSpace: true, spaceChildren: ["!salon", "!suite", "!board"] });
const salons = [equipe, salon("!salon"), salon("!suite"), salon("!ailleurs"), salon("!mp", { isDM: true }), salon("!board", { isSoundboard: true })];
beforeEach(() => {
  vi.clearAllMocks(); appel.rust = true;
  appel.leave.mockReset().mockResolvedValue(undefined);
  appel.enregistrer.mockResolvedValue(undefined);
  localStorage.clear();
  useEspacesStore.setState({ utilisateur: null, salonsQuittes: [], derniersSalons: {}, fenetre: null, espaceActif: null });
  useEspacesStore.getState().initialiser("@membre:sion");
  useEspacesStore.getState().choisir(equipe.id);
  useMatrixStore.setState({ currentUserId: "@membre:sion", channels: salons });
  useSettingsStore.setState({ sidebarView: "channels" });
  useAppStore.setState({ activeChannel: "!salon", connectedVoiceChannel: "!autre-vocal", pendingAutoJoinVoice: "!salon" });
});

it("quitte via Matrix et sélectionne un autre salon de la même équipe sans toucher aux MP ni au vocal", async () => {
  await quitterSalon(salons[1]);
  expect(appel.leave).toHaveBeenCalledExactlyOnceWith("!salon");
  expect(useMatrixStore.getState().channels.map((c) => c.id)).toEqual(["!equipe", "!suite", "!ailleurs", "!mp", "!board"]);
  expect(useAppStore.getState().activeChannel).toBe("!suite");
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!autre-vocal");
  expect(useAppStore.getState().pendingAutoJoinVoice).toBeNull();
  expect(useEspacesStore.getState().salonsQuittes).toEqual(["!salon"]);
});

it("un départ refusé conserve le salon, la sélection et l'autorisation de jointure automatique", async () => {
  appel.leave.mockRejectedValue(new Error("M_FORBIDDEN"));
  await expect(quitterSalon(salons[1])).rejects.toThrow("M_FORBIDDEN");
  expect(useMatrixStore.getState().channels).toEqual(salons);
  expect(useAppStore.getState().activeChannel).toBe("!salon");
  expect(useEspacesStore.getState().salonsQuittes).toEqual([]);
});

it("ne détourne pas une navigation effectuée pendant le départ", async () => {
  let terminer!: () => void;
  appel.leave.mockImplementation(() => new Promise<void>((resolve) => { terminer = resolve; }));
  const requete = quitterSalon(salons[1]);
  useAppStore.getState().setActiveChannel("!ailleurs", false);
  terminer(); await requete;
  expect(useAppStore.getState().activeChannel).toBe("!ailleurs");
});

it("nettoie m.direct avec le moteur JS et reste dans les MP", async () => {
  appel.rust = false;
  appel.donnees.mockReturnValue({ getContent: () => ({ "@alice:hs": ["!mp", "!mp2"], "@bob:hs": ["!mp"] }) });
  useSettingsStore.setState({ sidebarView: "dm" });
  useAppStore.setState({ activeChannel: "!mp" });
  useMatrixStore.setState({ channels: [...salons, salon("!mp2", { isDM: true })] });
  await quitterSalon(salons[4]);
  expect(appel.leave).toHaveBeenCalledExactlyOnceWith("!mp");
  expect(appel.enregistrer).toHaveBeenCalledWith("m.direct", { "@alice:hs": ["!mp2"] });
  expect(useAppStore.getState().activeChannel).toBe("!mp2");
  expect(useEspacesStore.getState().salonsQuittes).toEqual([]);
});

it("le dernier salon laisse le chat vide sans ouvrir une bibliothèque ou un autre espace", async () => {
  useMatrixStore.setState({ channels: salons.filter((c) => c.id !== "!suite") });
  await quitterSalon(salons[1]);
  expect(useAppStore.getState().activeChannel).toBe("");
});
it("ne modifie pas les salons d'un compte connecté pendant le nettoyage d'un MP", async () => {
  appel.rust = false;
  let terminer!: () => void;
  appel.donnees.mockReturnValue({ getContent: () => ({ "@alice:hs": ["!mp"] }) });
  appel.enregistrer.mockImplementationOnce(() => new Promise<void>((resolve) => { terminer = resolve; }));
  const requete = quitterSalon(salons[4]);
  await vi.waitFor(() => expect(appel.enregistrer).toHaveBeenCalled());
  const autresSalons = [salon("!nouveau-compte")];
  useMatrixStore.setState({ currentUserId: "@autre:hs", channels: autresSalons });
  useAppStore.setState({ activeChannel: "!nouveau-compte" });
  terminer(); await requete;
  expect(useMatrixStore.getState().channels).toBe(autresSalons);
  expect(useAppStore.getState().activeChannel).toBe("!nouveau-compte");
});
