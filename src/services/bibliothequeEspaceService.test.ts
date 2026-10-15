import { beforeEach, expect, it, vi } from "vitest";
import { chargerBibliothequeEspace, inviterBibliothequeEspace, modererBibliothequeEspace } from "./bibliothequeEspaceService";

const mock = vi.hoisted(() => ({ rust: true, compte: "@moi:hs", admin: true, salon: "!board" as string | null,
  pouvoir: 100, details: vi.fn(), etats: vi.fn(), lireEtat: vi.fn(), inviter: vi.fn(), expulser: vi.fn(), bannir: vi.fn(), debannir: vi.fn(), client: null as unknown }));
vi.mock("./moteur", () => ({ moteurRust: () => mock.rust }));
vi.mock("../stores/useMatrixStore", () => ({ useMatrixStore: { getState: () => ({ currentUserId: mock.compte }) } }));
vi.mock("./espacesService", () => ({ administrateurEspace: async () => mock.admin, espaceSelectionne: () => ({ boardRoomId: mock.salon }), lireEtat: mock.lireEtat }));
vi.mock("./matrixCore", () => ({ detailsSalon: mock.details, etats: mock.etats }));
vi.mock("./matrixService", () => ({ getMatrixClient: () => mock.client, inviteUser: mock.inviter, kickUser: mock.expulser, banUser: mock.bannir, unbanUser: mock.debannir }));
const profil = (userId: string, powerLevel = 0) => ({ userId, displayName: userId.slice(1).split(":")[0], powerLevel });
const equipe = ["@moi:hs", "@present:hs", "@attente:hs", "@absent:hs", "@parti:hs", "@expulse:hs", "@banni:hs"].map((id) => profil(id, id === "@moi:hs" ? 100 : 0));
const presents = [profil("@moi:hs", 100), profil("@present:hs"), profil("@pair:hs", 100), profil("@createur:hs", Infinity)];
let etats: { stateKey: string; content: Record<string, unknown>; sender: string }[];
const evenement = (id: string, membership: string, sender = id) => ({ stateKey: id, sender, content: { membership, displayname: id.slice(1).split(":")[0] } });
beforeEach(() => {
  vi.resetAllMocks(); mock.rust = true; mock.compte = "@moi:hs"; mock.admin = true; mock.salon = "!board"; mock.pouvoir = 100;
  etats = [...presents.map((m) => evenement(m.userId, "join")), evenement("@attente:hs", "invite", "@moi:hs"),
    evenement("@parti:hs", "leave"), evenement("@expulse:hs", "leave", "@moi:hs"), evenement("@banni:hs", "ban", "@moi:hs")];
  mock.details.mockImplementation(async (id: string) => ({ moi: mock.pouvoir,
    membres: id === "!equipe" ? equipe : presents, adhesions: id === "!equipe" ? [] : etats }));
  mock.lireEtat.mockImplementation(async (_id: string, type: string) => type === "com.sion.space" ? { board_room_id: mock.salon }
    : { invite: 50, kick: 50, ban: 75, users: { "@moi:hs": mock.pouvoir, "@pair:hs": 100 } });
  mock.inviter.mockResolvedValue(undefined); mock.expulser.mockResolvedValue(undefined); mock.bannir.mockResolvedValue(undefined); mock.debannir.mockResolvedValue(undefined);
  mock.client = { getUserId: () => "@moi:hs", members: vi.fn(async (id: string) => ({ chunk: (id === "!equipe" ? equipe.map((m) => evenement(m.userId, "join")) : etats)
    .map((e) => ({ state_key: e.stateKey, sender: e.sender, content: e.content })) })),
    getRoom: () => ({ loadMembersIfNeeded: vi.fn().mockResolvedValue(undefined),
      getMember: (id: string) => ({ powerLevel: id === "@moi:hs" ? mock.pouvoir : presents.find((m) => m.userId === id)?.powerLevel ?? 0 }) }) };
});
it.each([true, false])("sépare présents, invités, absents et exclus depuis des listes complètes (Rust : %s)", async (rust) => {
  mock.rust = rust;
  const acces = await chargerBibliothequeEspace("!equipe");
  expect(acces.membres.map((m) => m.userId)).toEqual(["@createur:hs", "@moi:hs", "@pair:hs", "@present:hs"]);
  expect(acces.invitations.map((m) => m.userId)).toEqual(["@attente:hs"]);
  expect(acces.manquants.map((m) => m.userId)).toEqual(["@absent:hs", "@parti:hs"]);
  expect(acces.exclus.map((m) => [m.userId, m.banni])).toEqual([["@banni:hs", true], ["@expulse:hs", false]]);
  expect(acces.peutInviter).toBe(true);
  for (const id of ["@moi:hs", "@pair:hs", "@createur:hs"]) expect(acces.membres.find((m) => m.userId === id)?.peutExpulser).toBe(false);
  expect(acces.membres.find((m) => m.userId === "@present:hs")).toMatchObject({ peutExpulser: true, peutBannir: true });
  if (rust) { expect(mock.details).toHaveBeenCalledWith("!equipe", true); expect(mock.details).toHaveBeenCalledWith("!board", true); expect(mock.etats).not.toHaveBeenCalled(); }
});
it("ne déclare pas le salon absent si la lecture échoue et refuse de désigner l'espace lui-même", async () => {
  mock.lireEtat.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  await expect(chargerBibliothequeEspace("!equipe")).rejects.toThrow("M_FORBIDDEN");
  mock.salon = "!equipe";
  await expect(chargerBibliothequeEspace("!equipe")).rejects.toThrow("spaces.libraryUnavailable");
});
it("distingue une bibliothèque absente et n'en cherche pas une autre", async () => {
  mock.salon = null;
  expect(await chargerBibliothequeEspace("!equipe")).toMatchObject({ salon: null, administrateur: true });
  expect(mock.details).not.toHaveBeenCalledWith("!board", true);
});
it("invite uniquement les membres manquants sans réinviter les présents, invitations ou exclus", async () => {
  expect(await inviterBibliothequeEspace("!equipe", "!board")).toEqual({ echecs: [], invitedCount: 2 });
  expect(mock.inviter.mock.calls).toEqual([["!board", "@absent:hs"], ["!board", "@parti:hs"]]);
  mock.inviter.mockClear();
  await inviterBibliothequeEspace("!equipe", "!board", "@absent:hs");
  expect(mock.inviter).toHaveBeenCalledExactlyOnceWith("!board", "@absent:hs");
});
it("compte les succès et conserve les échecs individuels pour une nouvelle tentative", async () => {
  mock.inviter.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  expect(await inviterBibliothequeEspace("!equipe", "!board")).toEqual({ echecs: ["@absent:hs"], invitedCount: 1 });
});
it.each(["expulser", "bannir"] as const)("%s agit uniquement sur la bibliothèque avec le motif fourni", async (action) => {
  await modererBibliothequeEspace("!equipe", "!board", "@present:hs", action, " abus ");
  expect(action === "expulser" ? mock.expulser : mock.bannir).toHaveBeenCalledExactlyOnceWith("!board", "@present:hs", "abus");
  expect(mock.inviter).not.toHaveBeenCalled();
});
it("rétablit un banni avant de l'inviter, mais ne débannit pas un simple expulsé", async () => {
  await modererBibliothequeEspace("!equipe", "!board", "@banni:hs", "retablir");
  expect(mock.debannir).toHaveBeenCalledExactlyOnceWith("!board", "@banni:hs");
  expect(mock.debannir.mock.invocationCallOrder[0]).toBeLessThan(mock.inviter.mock.invocationCallOrder[0]);
  await modererBibliothequeEspace("!equipe", "!board", "@expulse:hs", "retablir");
  expect(mock.debannir).toHaveBeenCalledTimes(1);
  expect(mock.inviter.mock.calls).toEqual([["!board", "@banni:hs"], ["!board", "@expulse:hs"]]);
});
it.each(["@moi:hs", "@pair:hs", "@createur:hs", "@absent:hs"])("refuse de modérer %s selon les droits du salon", async (user) => {
  await expect(modererBibliothequeEspace("!equipe", "!board", user, "expulser")).rejects.toThrow("spaces.permissionDenied");
  expect(mock.expulser).not.toHaveBeenCalled();
});
it("vérifie à nouveau les permissions, la désignation et le compte avant toute action", async () => {
  mock.pouvoir = 0;
  await expect(inviterBibliothequeEspace("!equipe", "!board")).rejects.toThrow("spaces.permissionDenied");
  mock.pouvoir = 100; mock.salon = "!autre";
  await expect(inviterBibliothequeEspace("!equipe", "!board")).rejects.toThrow("spaces.libraryChanged");
  mock.details.mockImplementationOnce(async () => { mock.compte = "@autre:hs"; return { moi: 100, membres: equipe }; });
  await expect(inviterBibliothequeEspace("!equipe", "!autre")).rejects.toThrow("spaces.libraryChanged");
  expect(mock.inviter).not.toHaveBeenCalled();
});
it("arrête un lot d'invitations lorsque le compte change", async () => {
  mock.inviter.mockImplementationOnce(async () => { mock.compte = "@autre:hs"; });
  await expect(inviterBibliothequeEspace("!equipe", "!board")).rejects.toThrow("spaces.libraryChanged");
  expect(mock.inviter).toHaveBeenCalledTimes(1);
});
it("un refus de débannissement ne provoque aucune invitation", async () => {
  mock.debannir.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  await expect(modererBibliothequeEspace("!equipe", "!board", "@banni:hs", "retablir")).rejects.toThrow("M_FORBIDDEN");
  expect(mock.inviter).not.toHaveBeenCalled();
});
