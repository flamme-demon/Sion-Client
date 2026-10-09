import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { GestionSalonsServeur } from "./GestionSalonsServeur";
import { AdminPanel } from "../layout/AdminPanel";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useEspacesStore } from "../../stores/useEspacesStore";
import type { Channel } from "../../types/matrix";

const appels = vi.hoisted(() => ({ liste: vi.fn(), hierarchie: vi.fn(), ban: vi.fn(), commande: vi.fn() }));
vi.mock("../../i18n", () => ({ default: { t: (cle: string) => cle, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string, options?: { name?: string }) => options?.name ? `${cle} : ${options.name}` : cle }) }));
vi.mock("../../services/adminService", () => ({ getRoomsList: appels.liste, banRoom: appels.ban }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => "!admin", sendAdminCommand: appels.commande }));
vi.mock("../../services/matrixService", () => ({ getMatrixClient: () => null }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => true }));
vi.mock("../../services/cacheRust", () => ({ detailsFrais: async () => ({ membres: [] }) }));
vi.mock("../../services/espacesService", () => ({ hierarchieEspace: appels.hierarchie, rejoindreSalonsCommuns: vi.fn() }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("./AdminStats", () => ({ AdminStats: () => null }));
vi.mock("./PendingUsers", () => ({ PendingUsers: () => null }));
vi.mock("./RegistrationTokens", () => ({ RegistrationTokens: () => null }));

const vue = montage();
const fermer = vi.fn();
const salon = (id: string, extra: Partial<Channel> = {}): Channel => ({ id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...extra });
const channels = [salon("!A", { name: "Atelier", isSpace: true, spaceChildren: ["!general", "!board", "!archive"], boardRoomId: "!board" }),
  salon("!general", { name: "Général" }), salon("!mp", { name: "Alice", isDM: true })];
const dialogue = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const ligne = (id: string) => document.querySelector<HTMLElement>(`[data-salon-serveur="${id}"]`)!;
const clic = async (element: HTMLElement) => act(async () => element.click());
beforeEach(() => {
  vi.clearAllMocks();
  appels.liste.mockResolvedValue({ rooms: ["!A", "!general", "!board", "!mp", "!archive", "!opaque", "!admin"] });
  appels.hierarchie.mockResolvedValue([{ room_id: "!A", room_type: "m.space" }, { room_id: "!archive", name: "Archives" }]);
  appels.ban.mockReset().mockResolvedValue(undefined);
  appels.commande.mockResolvedValue("");
  useMatrixStore.setState({ channels, currentUserId: "@moi:hs" });
  useEspacesStore.setState({ espaceActif: null, fenetre: null });
  useAppStore.setState({ showAdmin: true, activeChannel: "!general", connectedVoiceChannel: "!vocal" });
});
afterEach(() => vi.restoreAllMocks());

it("distingue les types, affiche les noms et rattache les salons à leur Espace", async () => {
  await vue.render(<GestionSalonsServeur onFermer={fermer} />);
  expect(vue.container.contains(dialogue())).toBe(false);
  expect(document.querySelector('[data-type-salon="espaces"]')?.textContent).toContain("Atelier");
  expect(document.querySelector('[data-type-salon="salons"]')?.textContent).toContain("Général");
  expect(ligne("!archive").textContent).toContain("Archives");
  expect(ligne("!archive").textContent).toContain("Atelier");
  expect(document.querySelector('[data-type-salon="bibliotheques"]')?.textContent).toContain("Atelier");
  expect(document.querySelector('[data-type-salon="mp"]')?.textContent).toContain("Alice");
  expect(ligne("!mp").querySelector("button")).toBeNull();
  expect(ligne("!opaque").textContent).toContain("admin.actions.unknownRoomName");
  expect(document.querySelector('[data-salon-serveur="!admin"]')).toBeNull();
});
it("filtre par type et recherche aussi le nom d'un Espace et les IDs", async () => {
  await vue.render(<GestionSalonsServeur onFermer={fermer} />);
  const mp = Array.from(dialogue().querySelectorAll<HTMLButtonElement>("nav button")).find((b) => b.textContent?.startsWith("admin.actions.sectionDMs"))!;
  await clic(mp);
  expect(document.querySelectorAll("[data-salon-serveur]")).toHaveLength(1);
  expect(ligne("!mp")).not.toBeNull();
  await clic(dialogue().querySelector<HTMLButtonElement>("nav button")!);
  const champ = dialogue().querySelector<HTMLInputElement>("input")!;
  const chercher = async (texte: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(champ, texte);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await chercher("Atelier");
  expect(ligne("!archive")).not.toBeNull();
  expect(document.querySelector('[data-salon-serveur="!mp"]')).toBeNull();
  await chercher("!opaque");
  expect(document.querySelectorAll("[data-salon-serveur]")).toHaveLength(1);
  expect(ligne("!opaque")).not.toBeNull();
});
it("ouvre les réglages de l'espace choisi sans déplacer l'appel vocal", async () => {
  await vue.render(<GestionSalonsServeur onFermer={fermer} />);
  const bouton = Array.from(ligne("!A").querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "spaces.manage")!;
  await clic(bouton);
  expect(fermer).toHaveBeenCalledOnce();
  expect(useEspacesStore.getState().espaceActif).toBe("!A");
  expect(useEspacesStore.getState().fenetre).toBe("gerer");
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
});
it("la suppression exige de confirmer le nom de l'élément et ne touche pas ses voisins", async () => {
  await vue.render(<GestionSalonsServeur onFermer={fermer} />);
  await clic(ligne("!general").querySelector<HTMLButtonElement>("button")!);
  const confirmation = document.querySelector<HTMLElement>('[role="group"]')!;
  expect(confirmation.textContent).toContain("Général");
  expect(appels.ban).not.toHaveBeenCalled();
  await clic(Array.from(confirmation.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "admin.actions.confirmYes")!);
  expect(appels.ban).toHaveBeenCalledExactlyOnceWith("!general", true);
  expect(document.querySelector('[data-salon-serveur="!general"]')).toBeNull();
  expect(ligne("!A")).not.toBeNull();
  expect(ligne("!mp")).not.toBeNull();
});
it("affiche les erreurs de chargement sans les confondre avec un serveur vide", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  appels.liste.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  await vue.render(<GestionSalonsServeur onFermer={fermer} />);
  expect(dialogue().querySelector('[role="alert"]')?.textContent).toBe("admin.actions.roomsLoadFailed");
  expect(dialogue().textContent).not.toContain("admin.actions.noRooms");
});
it("le menu serveur n'a plus de bouton soundboard et reste ouvert en manipulant sa fenêtre en portail", async () => {
  function Interface() {
    const ouvert = useAppStore((s) => s.showAdmin);
    return <><button id="ailleurs">Ailleurs</button>{ouvert && <AdminPanel />}</>;
  }
  await vue.render(<Interface />);
  expect(vue.container.querySelector('[title="admin.actions.soundboard"]')).toBeNull();
  const gerer = vue.container.querySelector<HTMLButtonElement>('[title="admin.actions.manageRooms"]')!;
  expect(gerer.textContent).toContain("admin.actions.manageRooms");
  await clic(gerer);
  expect(dialogue()).not.toBeNull();
  const input = dialogue().querySelector<HTMLInputElement>("input")!;
  await act(async () => input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(useAppStore.getState().showAdmin).toBe(true);
  expect(dialogue()).not.toBeNull();
  await clic(dialogue().querySelector<HTMLButtonElement>('[aria-label="chat.close"]')!);
  expect(dialogue()).toBeNull();
  await act(async () => vue.container.querySelector("#ailleurs")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(useAppStore.getState().showAdmin).toBe(false);
});
