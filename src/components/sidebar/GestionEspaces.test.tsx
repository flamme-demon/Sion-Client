import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { GestionEspaces } from "./GestionEspaces";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import type { Channel } from "../../types/matrix";

const appels = vi.hoisted(() => ({ leave: vi.fn(), vocal: vi.fn(), admin: false, responsable: false, bibliotheque: vi.fn(), modifier: vi.fn(), creerSalon: vi.fn(), invitations: vi.fn(), membres: vi.fn(), inviter: vi.fn(), rechercher: vi.fn(), rejoindre: vi.fn(), changerRole: vi.fn(), inviterBibliotheque: vi.fn() }));
vi.mock("../../services/bibliothequeEspaceService", () => ({
  chargerBibliothequeEspace: async (id: string) => ({ salon: useMatrixStore.getState().channels.find((c) => c.id === id)?.boardRoomId ?? null,
    administrateur: appels.admin, peutInviter: appels.admin, membres: [], invitations: [], exclus: [], manquants: [{ userId: "@alice:hs", displayName: "Alice", powerLevel: 0 }] }),
  inviterBibliothequeEspace: appels.inviterBibliotheque, modererBibliothequeEspace: vi.fn(),
}));
vi.mock("../../hooks/useVoiceChannel", () => ({ useVoiceChannel: () => ({ leaveVoiceChannel: appels.vocal }) }));
vi.mock("./ParcourirSalonsEspace", () => ({ ParcourirSalonsEspace: ({ espaceId }: { espaceId: string }) => <div data-choix-salons={espaceId} /> }));
vi.mock("../../i18n", () => ({ default: { t: (cle: string) => cle, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string) => cle, i18n: { exists: () => true } }) }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => null }));
vi.mock("../../services/matrixService", () => ({ findSoundboardRoom: async () => null, inviteUser: appels.inviter, rechercherUtilisateurs: appels.rechercher, leaveRoom: appels.leave }));
vi.mock("../../services/espacesService", () => ({
  responsables: async () => appels.responsable,
  administrateurEspace: async () => appels.admin,
  creerBibliotheque: appels.bibliotheque,
  modifierEspace: appels.modifier,
  creerSalonDansEspace: appels.creerSalon,
  membresEspace: appels.membres,
  changerRoleEspace: appels.changerRole,
  invitationsEspace: appels.invitations,
  hierarchieEspace: async () => [{ room_id: "!equipe", room_type: "m.space" }, { room_id: "!salon", name: "Général", join_rule: "restricted" }],
  lienEspace: (id: string) => `https://matrix.to/#/${id}`,
  rejoindreSalonsCommuns: vi.fn(),
  rejoindreEspace: appels.rejoindre,
}));
vi.mock("../../services/conservationService", async (original) => ({ ...await original<typeof import("../../services/conservationService")>(),
  lireConservation: async (id: string) => ({ available: false, applying: false, lastRun: null, rooms: [],
    scope: { id, name: "Equipe", isSpace: true, policy: { mode: "unlimited" }, effectiveDays: null, parentId: null, parentName: null, editable: false, protected: false } }) }));
const vue = montage();
const salons: Channel[] = [
  { id: "!equipe", name: "Equipe", isSpace: true, membership: "join", spaceChildren: ["!salon"], hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0 },
  { id: "!salon", name: "Général", membership: "join", hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0 },
];
const quitter = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent === "spaces.leave")!;
const rubrique = async (id: string) => { await act(async () => document.querySelector<HTMLButtonElement>(`#espace-onglet-${id}`)!.click()); };
beforeEach(() => {
  appels.leave.mockReset().mockResolvedValue(undefined);
  appels.vocal.mockReset().mockResolvedValue(undefined);
  appels.admin = false; appels.responsable = false;
  appels.bibliotheque.mockReset().mockResolvedValue({ roomId: "!board", alreadyExisted: false, invitedCount: 0, echecs: [] });
  appels.modifier.mockReset().mockResolvedValue(undefined);
  appels.creerSalon.mockReset().mockResolvedValue("!nouveau");
  appels.invitations.mockReset().mockResolvedValue([]);
  appels.membres.mockReset().mockResolvedValue([{ userId: "@membre:hs", displayName: "Membre", powerLevel: 0 }]);
  appels.inviter.mockReset().mockResolvedValue(undefined);
  appels.rechercher.mockReset().mockResolvedValue({ utilisateurs: [{ userId: "@alice:hs", displayName: "Alice", avatarUrl: "/photo-test.png" }], limite: false });
  appels.rejoindre.mockReset().mockResolvedValue({ id: "!equipe" });
  appels.changerRole.mockReset().mockResolvedValue([]);
  appels.inviterBibliotheque.mockReset().mockResolvedValue({ invitedCount: 1, echecs: [] });
  useEspacesStore.setState({ utilisateur: "@membre:hs", espaceActif: "!equipe", fenetre: "gerer", rubrique: "general", salonsQuittes: [], hierarchies: {} });
  useMatrixStore.setState({ channels: salons, currentUserId: "@membre:hs" });
  useAppStore.setState({ activeChannel: "!salon", connectedVoiceChannel: null, connectingVoiceChannel: null, pendingAutoJoinVoice: null, reconnexionVocale: null });
});
it("l'acceptation d'une invitation à un espace propose ensuite le choix de ses salons", async () => {
  useMatrixStore.setState({ channels: salons.map((s) => s.isSpace ? { ...s, membership: "invite" } : s) });
  await vue.render(<GestionEspaces />);
  const accepter = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "spaces.accept")!;
  await act(async () => accepter.click());
  expect(appels.rejoindre).toHaveBeenCalledExactlyOnceWith("https://matrix.to/#/!equipe");
  expect(useEspacesStore.getState().fenetre).toBe("parcourir");
  expect(document.querySelector('[data-choix-salons="!equipe"]')).not.toBeNull();
});
afterEach(() => vi.useRealTimers());
it.each([false, true])("l'accès direct aux membres regroupe la liste, les rôles et les invitations selon les droits (%s)", async (responsable) => {
  appels.responsable = responsable;
  appels.invitations.mockResolvedValue([{ userId: "@alice:hs", displayName: "Alice", avatarUrl: null }]);
  useEspacesStore.getState().ouvrir("gerer", "membres");
  await vue.render(<GestionEspaces />);
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe("espace-onglet-membres");
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("@membre:hs");
  expect(document.querySelector('.sion-espaces-invitations')?.textContent).toContain("@alice:hs");
  expect(appels.membres).toHaveBeenCalledExactlyOnceWith("!equipe");
  const roles = document.querySelector<HTMLSelectElement>('[role="tabpanel"] select');
  expect(!!roles).toBe(responsable);
  expect(!!document.querySelector('[role="tabpanel"] [role="combobox"]')).toBe(responsable);
  if (roles) {
    await act(async () => { roles.value = "50"; roles.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(appels.changerRole).toHaveBeenCalledExactlyOnceWith("!equipe", "@membre:hs", 50);
  }
  await act(async () => useEspacesStore.getState().ouvrir("gerer"));
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe("espace-onglet-general");
});
it.each([false, true])("creates an encrypted room in the selected space (voice: %s)", async (vocal) => {
  appels.responsable = true;
  await vue.render(<GestionEspaces />);
  await rubrique("salons");
  const formulaire = document.querySelector<HTMLFormElement>('[role="tabpanel"] form')!;
  const casePour = (cle: string) => Array.from(formulaire.querySelectorAll("label"))
    .find((label) => label.textContent === cle)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(casePour("spaces.encryptedRoom").checked).toBe(false);
  await act(async () => {
    const nom = formulaire.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nom, "Réunion privée");
    nom.dispatchEvent(new Event("input", { bubbles: true }));
    casePour("spaces.encryptedRoom").click();
    if (vocal) casePour("spaces.voice").click();
    casePour("spaces.commonRoom").click();
  });
  expect(formulaire.textContent).toContain("spaces.encryptedRoomHelp");
  await act(async () => formulaire.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(appels.creerSalon).toHaveBeenCalledExactlyOnceWith("!equipe", "Réunion privée", vocal, false, true);
});
it("allows disabling encryption before creating a room", async () => {
  appels.responsable = true;
  await vue.render(<GestionEspaces />);
  await rubrique("salons");
  const formulaire = document.querySelector<HTMLFormElement>('[role="tabpanel"] form')!;
  const chiffre = Array.from(formulaire.querySelectorAll("label")).find((l) => l.textContent === "spaces.encryptedRoom")!.querySelector<HTMLInputElement>("input")!;
  await act(async () => chiffre.click());
  await act(async () => chiffre.click());
  expect(formulaire.textContent).not.toContain("spaces.encryptedRoomHelp");
  await act(async () => formulaire.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(appels.creerSalon.mock.calls[0]?.[4]).toBe(false);
});
it("propose Conservation dans les réglages de l'espace et désactive les durées sans extension serveur", async () => {
  await vue.render(<GestionEspaces />);
  await rubrique("conservation");
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("conservation.title");
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("conservation.unavailable");
  expect(document.querySelector<HTMLSelectElement>('[role="tabpanel"] select')?.disabled).toBe(true);
});
it("un modérateur de l'espace ne reçoit pas les boutons de création ou synchronisation de sa bibliothèque", async () => {
  appels.responsable = true;
  await vue.render(<GestionEspaces />);
  await rubrique("bibliotheque");
  expect(Array.from(document.querySelectorAll("button")).some((b) => ["spaces.createLibrary", "spaces.syncLibrary"].includes(b.textContent ?? ""))).toBe(false);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("spaces.libraryAdminOnly");
});
it.each([false, true])("un administrateur de l'espace gère sa bibliothèque (existante : %s)", async (existante) => {
  appels.admin = true; appels.responsable = true;
  if (existante) useMatrixStore.setState({ channels: salons.map((s) => s.isSpace ? { ...s, boardRoomId: "!board" } : s) });
  await vue.render(<GestionEspaces />);
  await rubrique("bibliotheque");
  const bouton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === (existante ? "spaces.syncLibrary" : "spaces.createLibrary"))!;
  expect(bouton).toBeDefined();
  await act(async () => bouton.click());
  if (existante) expect(appels.inviterBibliotheque).toHaveBeenCalledExactlyOnceWith("!equipe", "!board", undefined);
  else expect(appels.bibliotheque).toHaveBeenCalledExactlyOnceWith("!equipe");
});
it("un simple membre peut quitter l'espace avec confirmation en conservant ses salons", async () => {
  await vue.render(<GestionEspaces />);
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("spaces.settings");
  expect(document.querySelector('[role="tabpanel"] input')).toBeNull();
  await rubrique("acces");
  expect(quitter()).toBeDefined();
  await act(async () => quitter().click());
  expect(appels.leave).not.toHaveBeenCalled();
  await act(async () => document.querySelectorAll<HTMLInputElement>('[data-depart-espace] input[type=radio]')[1].click());
  expect(document.querySelector("[data-depart-salon]")).toBeNull();
  await act(async () => quitter().click());
  expect(appels.leave).toHaveBeenCalledExactlyOnceWith("!equipe");
  expect(useEspacesStore.getState().espaceActif).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useMatrixStore.getState().channels.find((c) => c.id === "!salon")?.membership).toBe("join");
});
it("un refus du serveur laisse l'espace ouvert et affiche l'erreur", async () => {
  appels.leave.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  await vue.render(<GestionEspaces />);
  await rubrique("acces");
  await act(async () => quitter().click());
  await act(async () => quitter().click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("spaces.leaveRoomsFailed");
  expect(useEspacesStore.getState().espaceActif).toBe("!equipe");
  expect(useEspacesStore.getState().fenetre).toBe("gerer");
});
it("le départ complet est sélectionné par défaut et quitte les salons avant l'espace", async () => {
  await vue.render(<GestionEspaces />); await rubrique("acces");
  await act(async () => quitter().click());
  expect(document.querySelector<HTMLInputElement>('[data-depart-espace] input[type=radio]')?.checked).toBe(true);
  expect(document.querySelector('[data-depart-espace]')?.textContent).toContain("Général");
  expect(document.querySelector<HTMLInputElement>('[data-depart-salon="!salon"]')?.checked).toBe(true);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-confirmer-depart-espace]')!.click());
  expect(appels.leave.mock.calls.map((a) => a[0])).toEqual(["!salon", "!equipe"]);
});
it("montre la bibliothèque sélectionnée et les salons partagés décochés, et permet de choisir ces derniers", async () => {
  const channels = [...salons.map((c) => c.isSpace ? { ...c, spaceChildren: ["!salon", "!commun"], boardRoomId: "!board" } : c),
    { ...salons[0], id: "!autre", name: "Autre équipe", spaceChildren: ["!commun"] },
    { ...salons[1], id: "!commun", name: "Salon partagé" },
    { ...salons[1], id: "!board", name: "Bibliothèque", isSoundboard: true }];
  useMatrixStore.setState({ channels });
  await vue.render(<GestionEspaces />); await rubrique("acces");
  await act(async () => quitter().click());
  expect(document.querySelector<HTMLInputElement>('[data-depart-salon="!board"]')?.checked).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[data-depart-salon="!commun"]')?.checked).toBe(false);
  await act(async () => document.querySelector<HTMLInputElement>('[data-depart-salon="!commun"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-confirmer-depart-espace]')!.click());
  expect(appels.leave.mock.calls.map((a) => a[0])).toEqual(["!salon", "!commun", "!board", "!equipe"]);
  expect(useMatrixStore.getState().channels.some((c) => c.id === "!autre")).toBe(true);
});
it("annuler la confirmation ne quitte aucune adhésion", async () => {
  await vue.render(<GestionEspaces />); await rubrique("acces");
  await act(async () => quitter().click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-annuler-depart-espace]')!.click());
  expect(document.querySelector("[data-depart-espace]")).toBeNull();
  expect(appels.leave).not.toHaveBeenCalled();
  expect(useMatrixStore.getState().channels).toEqual(salons);
});
it("sépare les rubriques et conserve les changements de nom et les brouillons de salon en naviguant", async () => {
  appels.responsable = true;
  await vue.render(<GestionEspaces />);
  expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain("spaces.joinCommon");
  const modifier = async (selecteur: string, valeur: string) => {
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>(selecteur)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valeur);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await modifier('[role="tabpanel"] input', "Nouvelle équipe");
  await rubrique("salons");
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain("spaces.libraryAdminOnly");
  await modifier('[role="tabpanel"] form input', "Salon brouillon");
  await rubrique("membres");
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("@membre:hs");
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain("spaces.joinCommon");
  await rubrique("general");
  expect(document.querySelector<HTMLInputElement>('[role="tabpanel"] input')?.value).toBe("Nouvelle équipe");
  await act(async () => document.querySelector('[role="tabpanel"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(appels.modifier).toHaveBeenCalledExactlyOnceWith("!equipe", "Nouvelle équipe", "", undefined);
  await rubrique("salons");
  expect(document.querySelector<HTMLInputElement>('[role="tabpanel"] form input')?.value).toBe("Salon brouillon");
});
it("permet la navigation au clavier sans rendre les cinq onglets tabulables", async () => {
  await vue.render(<GestionEspaces />);
  const onglet = document.querySelector<HTMLButtonElement>('#espace-onglet-general')!;
  onglet.focus();
  await act(async () => onglet.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement?.id).toBe("espace-onglet-salons");
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("spaces.rooms");
  expect(document.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement?.id).toBe("espace-onglet-acces");
  expect(quitter()).toBeDefined();
});

it("affiche les invitations déjà envoyées dans leur section, sans leur attribuer un rôle de membre", async () => {
  appels.responsable = true;
  appels.invitations.mockResolvedValue([{ userId: "@alice:hs", displayName: "Alice", avatarUrl: "/photo-test.png" }]);
  await vue.render(<GestionEspaces />); await rubrique("membres");
  const liste = document.querySelector('.sion-espaces-invitations')!;
  expect(liste.textContent).toContain("Alice"); expect(liste.textContent).toContain("@alice:hs");
  expect(liste.textContent).toContain("spaces.awaitingAcceptance");
  expect(liste.querySelector('img')?.getAttribute("src")).toBe("/photo-test.png");
  expect(liste.querySelector("select")).toBeNull();
  expect(document.querySelectorAll('[role="tabpanel"] select')).toHaveLength(1);
  expect(appels.invitations).toHaveBeenCalledExactlyOnceWith("!equipe");
});

it("actualise les invitations acceptées ou refusées et conserve la liste si le rafraîchissement échoue", async () => {
  appels.invitations.mockResolvedValue([{ userId: "@alice:hs", displayName: "Alice", avatarUrl: null }]);
  await vue.render(<GestionEspaces />); await rubrique("membres");
  appels.invitations.mockRejectedValueOnce(new Error("hors ligne"));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="spaces.refreshMembers"]')!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("hors ligne");
  expect(document.querySelector('.sion-espaces-invitations')?.textContent).toContain("@alice:hs");
  appels.invitations.mockResolvedValue([]);
  appels.membres.mockResolvedValue([{ userId: "@membre:hs", displayName: "Membre", powerLevel: 0 }, { userId: "@alice:hs", displayName: "Alice", powerLevel: 0 }]);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="spaces.refreshMembers"]')!.click());
  expect(document.querySelector('.sion-espaces-invitations')?.textContent).toContain("spaces.noPendingInvitations");
  expect(document.querySelector('.sion-espaces-invitations')?.textContent).not.toContain("@alice:hs");
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("@alice:hs");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it.each([true, false])("ajoute immédiatement le profil aux invitations seulement si l'envoi réussit (%s)", async (envoyee) => {
  vi.useFakeTimers(); appels.responsable = true;
  if (!envoyee) appels.inviter.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  await vue.render(<GestionEspaces />); await rubrique("membres");
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "alice");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  await act(async () => document.querySelector('[role="combobox"]')!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(appels.inviter).toHaveBeenCalledExactlyOnceWith("!equipe", "@alice:hs");
  expect(document.querySelector('.sion-espaces-invitations')!.textContent.includes("@alice:hs")).toBe(envoyee);
  if (envoyee) expect(document.querySelector('.sion-espaces-invitations img')?.getAttribute("src")).toBe("/photo-test.png");
  else expect(document.querySelector('[role="alert"]')?.textContent).toContain("M_FORBIDDEN");
});
