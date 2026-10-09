import { beforeEach, expect, it, vi } from "vitest";
import { hierarchieEspace, lierSalon, rejoindreSalonsCommuns, rejoindreEspace, creerSalonDansEspace, creerBibliotheque } from "./espacesService";
import { useEspacesStore } from "../stores/useEspacesStore";
const mock = vi.hoisted(() => ({ utilisateur: "@moi:sionchat.fr", channels: [] as { id: string; isSpace?: boolean; spaceChildren?: string[] }[], hierarchy: vi.fn(), rejoindre: vi.fn(), etats: vi.fn(), envoyer: vi.fn(), details: vi.fn(), creerSalon: vi.fn(), inviter: vi.fn() }));
vi.mock("./moteur", () => ({ moteurRust: () => true }));
vi.mock("../stores/useMatrixStore", () => ({ useMatrixStore: { getState: () => ({ channels: mock.channels, currentUserId: mock.utilisateur }) } }));
vi.mock("./matrixCore", () => ({ hierarchieEspace: mock.hierarchy, rejoindreAvecVia: mock.rejoindre, rejoindreEspace: mock.rejoindre, etats: mock.etats, envoyerEtat: mock.envoyer, detailsSalon: mock.details, creerSalon: mock.creerSalon }));
vi.mock("./matrixService", () => ({ getMatrixClient: () => null, inviteUser: mock.inviter, leaveRoom: vi.fn(), setRoomName: vi.fn(), setRoomTopic: vi.fn(), setRoomAvatar: vi.fn() }));
const child = (id: string, via = ["remote.example"]) => ({ type: "m.space.child", state_key: id, content: { via } });
beforeEach(() => { vi.clearAllMocks(); mock.utilisateur = "@moi:sionchat.fr"; useEspacesStore.setState({ salonsQuittes: [] }); mock.channels = []; mock.details.mockResolvedValue({ moi: 100, niveauEtat: 50, membres: [] }); mock.etats.mockResolvedValue([{ stateKey: "", content: { join_rule: "public" } }]); mock.envoyer.mockResolvedValue(undefined); mock.creerSalon.mockResolvedValue("!nouveau"); });
it("joint les salons communs de cette équipe avec leurs via, sans les privés ni ceux d'une autre équipe", async () => {
  mock.hierarchy.mockResolvedValue({ rooms: [
    { room_id: "!A", room_type: "m.space", children_state: [child("!public"), child("!commun"), child("!prive"), child("!autre"), child("!sous-espace")] },
    { room_id: "!public", join_rule: "public" }, { room_id: "!commun", join_rule: "restricted", allowed_room_ids: ["!A"] },
    { room_id: "!prive", join_rule: "invite" }, { room_id: "!autre", join_rule: "restricted", allowed_room_ids: ["!B"] }, { room_id: "!sous-espace", room_type: "m.space", join_rule: "public" },
  ] });
  expect(await rejoindreSalonsCommuns("!A")).toEqual([]);
  expect(mock.rejoindre.mock.calls).toEqual([["!public", ["remote.example"]], ["!commun", ["remote.example"]]]);
});
it("parcourt toute la pagination sans doublons", async () => {
  mock.hierarchy.mockResolvedValueOnce({ rooms: [{ room_id: "!A" }], next_batch: "suite" }).mockResolvedValueOnce({ rooms: [{ room_id: "!A" }, { room_id: "!B" }] });
  expect((await hierarchieEspace("!A")).map((r) => r.room_id)).toEqual(["!A", "!B"]);
  expect(mock.hierarchy).toHaveBeenLastCalledWith("!A", "suite");
});
it("refuse de transformer un salon privé en salon commun", async () => {
  mock.etats.mockResolvedValue([{ stateKey: "", content: { join_rule: "invite" } }]);
  await expect(lierSalon("!A", "!prive", true)).rejects.toThrow("spaces.privateRoom");
  expect(mock.envoyer).not.toHaveBeenCalled();
});
it("la création ne passe pas par la moulinette globale et conserve l'espace cible", async () => {
  await creerSalonDansEspace("!A", "Test", true, true);
  expect(mock.creerSalon).toHaveBeenCalledWith("Test", true, true, false, "!A", false);
  expect(mock.envoyer).toHaveBeenCalledWith("!A", "m.space.child", "!nouveau", { via: ["sionchat.fr"], suggested: true });
});
it("n'écrit aucun état lorsqu'un simple membre essaie de créer un salon", async () => {
  mock.details.mockResolvedValue({ moi: 0, niveauEtat: 50, membres: [] });
  await expect(creerSalonDansEspace("!A", "Test", false, true)).rejects.toThrow("spaces.permissionDenied");
  expect(mock.creerSalon).not.toHaveBeenCalled();
});
it("conserve le routage d'un Espace externe au moment de le rejoindre", async () => {
  mock.rejoindre.mockResolvedValue("!Opaque"); mock.hierarchy.mockResolvedValue({ rooms: [] });
  await rejoindreEspace("https://matrix.to/#/!Opaque?via=remote.example");
  expect(mock.rejoindre).toHaveBeenCalledWith("!Opaque", ["remote.example"]);
  expect(useEspacesStore.getState().espaceActif).toBe("!Opaque");
});
it("la jointure automatique respecte les salons quittés, mais un retour volontaire les réactive", async () => {
  useEspacesStore.setState({ salonsQuittes: ["!public"] });
  mock.hierarchy.mockResolvedValue({ rooms: [
    { room_id: "!A", room_type: "m.space", children_state: [child("!public"), child("!commun")] },
    { room_id: "!public", join_rule: "public" }, { room_id: "!commun", join_rule: "restricted", allowed_room_ids: ["!A"] },
  ] });
  mock.rejoindre.mockImplementation(async (id: string) => id);
  expect(await rejoindreSalonsCommuns("!A")).toEqual([]);
  expect(mock.rejoindre.mock.calls).toEqual([["!commun", ["remote.example"]]]);
  mock.rejoindre.mockClear();
  expect(await rejoindreSalonsCommuns("!A", false)).toEqual([]);
  expect(mock.rejoindre.mock.calls).toEqual([["!public", ["remote.example"]], ["!commun", ["remote.example"]]]);
  expect(useEspacesStore.getState().salonsQuittes).toEqual([]);
});
it.each([0, 50])("le niveau %s de l'espace ne permet pas de créer ou synchroniser la bibliothèque", async (moi) => {
  mock.details.mockResolvedValue({ moi, niveauEtat: 50, membres: [] });
  mock.etats.mockResolvedValue([{ stateKey: "", content: { board_room_id: "!boardA" } }]);
  await expect(creerBibliotheque("!A")).rejects.toThrow("spaces.libraryAdminOnly");
  expect(mock.creerSalon).not.toHaveBeenCalled();
  expect(mock.inviter).not.toHaveBeenCalled();
  expect(mock.envoyer).not.toHaveBeenCalled();
});
it("la synchronisation par un admin d'espace invite uniquement les membres de cette équipe dans sa bibliothèque", async () => {
  mock.details.mockResolvedValue({ moi: 100, niveauEtat: 50, membres: [
    { userId: "@moi:sionchat.fr" }, { userId: "@alice:hs" },
  ] });
  mock.etats.mockResolvedValue([{ stateKey: "", content: { board_room_id: "!boardA" } }]);
  mock.inviter.mockResolvedValue(undefined);
  expect(await creerBibliotheque("!A")).toMatchObject({ roomId: "!boardA", alreadyExisted: true, echecs: [] });
  expect(mock.inviter.mock.calls).toEqual([["!boardA", "@alice:hs"]]);
  expect(mock.creerSalon).not.toHaveBeenCalled();
});
it("la création par un admin désigne la nouvelle bibliothèque dans cet espace", async () => {
  const resultat = await creerBibliotheque("!A");
  expect(resultat).toMatchObject({ roomId: "!nouveau", alreadyExisted: false, echecs: [] });
  expect(mock.creerSalon).toHaveBeenCalledWith("Soundboard & Memeboard", false, true, false, "!A", true);
  expect(mock.envoyer).toHaveBeenCalledWith("!A", "com.sion.space", "", { board_room_id: "!nouveau" });
});

it("arrête les jointures automatiques si le compte change pendant la lecture de l'Espace", async () => {
  mock.hierarchy.mockImplementationOnce(async () => {
    mock.utilisateur = "@autre:hs";
    return { rooms: [
      { room_id: "!A", children_state: [child("!public")] },
      { room_id: "!public", join_rule: "public" },
    ] };
  });
  expect(await rejoindreSalonsCommuns("!A")).toEqual([]);
  expect(mock.rejoindre).not.toHaveBeenCalled();
});

it("signale les invitations échouées aussi lors de la création d'une bibliothèque", async () => {
  mock.details.mockImplementation(async (salon: string) => ({ moi: 100, niveauEtat: 50,
    membres: salon === "!A" ? [{ userId: "@alice:hs" }] : [],
  }));
  mock.inviter.mockRejectedValue(new Error("invitation refusée"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await creerBibliotheque("!A")).toMatchObject({ roomId: "!nouveau", echecs: ["@alice:hs"] });
  expect(mock.inviter).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});
