import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { GestionEspaces } from "./GestionEspaces";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import type { Channel } from "../../types/matrix";

const appels = vi.hoisted(() => ({ leave: vi.fn(), admin: false, responsable: false, bibliotheque: vi.fn() }));
vi.mock("../../i18n", () => ({ default: { t: (cle: string) => cle, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string) => cle, i18n: { exists: () => true } }) }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => null }));
vi.mock("../../services/matrixService", () => ({ findSoundboardRoom: async () => null, inviteUser: vi.fn(), leaveRoom: appels.leave }));
vi.mock("../../services/espacesService", () => ({
  responsables: async () => appels.responsable,
  administrateurEspace: async () => appels.admin,
  creerBibliotheque: appels.bibliotheque,
  membresEspace: async () => [{ userId: "@membre:hs", displayName: "Membre", powerLevel: 0 }],
  hierarchieEspace: async () => [{ room_id: "!equipe", room_type: "m.space" }, { room_id: "!salon", name: "Général", join_rule: "restricted" }],
  lienEspace: (id: string) => `https://matrix.to/#/${id}`,
  rejoindreSalonsCommuns: vi.fn(),
}));
const vue = montage();
const salons: Channel[] = [
  { id: "!equipe", name: "Equipe", isSpace: true, membership: "join", spaceChildren: ["!salon"], hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0 },
  { id: "!salon", name: "Général", membership: "join", hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0 },
];
const quitter = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent === "spaces.leave")!;
beforeEach(() => {
  appels.leave.mockReset().mockResolvedValue(undefined);
  appels.admin = false; appels.responsable = false;
  appels.bibliotheque.mockReset().mockResolvedValue({ roomId: "!board", alreadyExisted: false, invitedCount: 0, echecs: [] });
  useEspacesStore.setState({ espaceActif: "!equipe", fenetre: "gerer", salonsQuittes: [] });
  useMatrixStore.setState({ channels: salons, currentUserId: "@membre:hs" });
  useAppStore.setState({ activeChannel: "!salon" });
});
it("un modérateur de l'espace ne reçoit pas les boutons de création ou synchronisation de sa bibliothèque", async () => {
  appels.responsable = true;
  await vue.render(<GestionEspaces />);
  expect(Array.from(document.querySelectorAll("button")).some((b) => ["spaces.createLibrary", "spaces.syncLibrary"].includes(b.textContent ?? ""))).toBe(false);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("spaces.libraryAdminOnly");
});
it.each([false, true])("un administrateur de l'espace gère sa bibliothèque (existante : %s)", async (existante) => {
  appels.admin = true; appels.responsable = true;
  if (existante) useMatrixStore.setState({ channels: salons.map((s) => s.isSpace ? { ...s, boardRoomId: "!board" } : s) });
  await vue.render(<GestionEspaces />);
  const bouton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === (existante ? "spaces.syncLibrary" : "spaces.createLibrary"))!;
  expect(bouton).toBeDefined();
  await act(async () => bouton.click());
  expect(appels.bibliotheque).toHaveBeenCalledExactlyOnceWith("!equipe");
});
it("un simple membre peut quitter l'espace avec confirmation en conservant ses salons", async () => {
  await vue.render(<GestionEspaces />);
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("spaces.settings");
  expect(quitter()).toBeDefined();
  await act(async () => quitter().click());
  expect(appels.leave).not.toHaveBeenCalled();
  await act(async () => quitter().click());
  expect(appels.leave).toHaveBeenCalledExactlyOnceWith("!equipe");
  expect(useEspacesStore.getState().espaceActif).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useMatrixStore.getState().channels.find((c) => c.id === "!salon")?.membership).toBe("join");
});
it("un refus du serveur laisse l'espace ouvert et affiche l'erreur", async () => {
  appels.leave.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  await vue.render(<GestionEspaces />);
  await act(async () => quitter().click());
  await act(async () => quitter().click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("M_FORBIDDEN");
  expect(useEspacesStore.getState().espaceActif).toBe("!equipe");
  expect(useEspacesStore.getState().fenetre).toBe("gerer");
});
