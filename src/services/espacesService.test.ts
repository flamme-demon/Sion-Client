import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decouvrirSalonsEspace, viderDecouvertesEspaces, hierarchieEspace, lierSalon, rejoindreSalonsCommuns, rejoindreEspace, creerSalonDansEspace, creerBibliotheque, invitationsEspace } from "./espacesService";
import { useEspacesStore } from "../stores/useEspacesStore";
const mock = vi.hoisted(() => ({ utilisateur: "@moi:sionchat.fr", rust: true, client: null as unknown, channels: [] as { id: string; isSpace?: boolean; spaceChildren?: string[] }[], hierarchy: vi.fn(), rejoindre: vi.fn(), etats: vi.fn(), envoyer: vi.fn(), details: vi.fn(), creerSalon: vi.fn(), inviter: vi.fn(), media: vi.fn() }));
vi.mock("./moteur", () => ({ moteurRust: () => mock.rust }));
vi.mock("../stores/useMatrixStore", () => ({ useMatrixStore: { getState: () => ({ channels: mock.channels, currentUserId: mock.utilisateur }) } }));
vi.mock("./matrixCore", () => ({ hierarchieEspace: mock.hierarchy, rejoindreAvecVia: mock.rejoindre, rejoindreEspace: mock.rejoindre, etats: mock.etats, envoyerEtat: mock.envoyer, detailsSalon: mock.details, creerSalon: mock.creerSalon, urlMedia: mock.media }));
vi.mock("./matrixService", () => ({ getMatrixClient: () => mock.client, mxcToHttp: (mxc: string) => `https://media.test/${mxc.split("/").at(-1)}`, inviteUser: mock.inviter, leaveRoom: vi.fn(), setRoomName: vi.fn(), setRoomTopic: vi.fn(), setRoomAvatar: vi.fn() }));
const child = (id: string, via = ["remote.example"]) => ({ type: "m.space.child", state_key: id, content: { via } });
afterEach(() => vi.useRealTimers());
beforeEach(() => { viderDecouvertesEspaces(); vi.clearAllMocks(); mock.rust = true; mock.client = null; mock.utilisateur = "@moi:sionchat.fr"; useEspacesStore.setState({ salonsQuittes: [] }); mock.channels = []; mock.details.mockResolvedValue({ moi: 100, niveauEtat: 50, membres: [] }); mock.etats.mockResolvedValue([{ stateKey: "", content: { join_rule: "public" } }]); mock.envoyer.mockResolvedValue(undefined); mock.creerSalon.mockResolvedValue("!nouveau"); mock.media.mockReset().mockResolvedValue("sion-media://localhost/photo"); });
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
it.each([true, false])("propose les salons d'un serveur ancien même sans join_rule (Rust : %s)", async (rust) => {
  mock.rust = rust;
  const reponse = { rooms: [
    { room_id: "!A", room_type: "m.space", children_state: [child("!fr"), child("!cache"), child("!sous-espace"), child("!supprime", [])] },
    { room_id: "!fr", name: "Manjaro (French)", children_state: [] },
    { room_id: "!sous-espace", room_type: "m.space", children_state: [] },
    { room_id: "!ailleurs", name: "Ne fait pas partie de l'espace" },
  ] };
  mock.hierarchy.mockResolvedValue(reponse);
  mock.client = { getRoomHierarchy: vi.fn().mockResolvedValue(reponse) };
  const liste = await decouvrirSalonsEspace("!A");
  expect(liste.map((r) => r.room_id)).toEqual(["!fr", "!sous-espace"]);
  expect(liste[0]).toMatchObject({ name: "Manjaro (French)", via: ["remote.example"] });
  expect(mock.rejoindre).not.toHaveBeenCalled();
  expect(useEspacesStore.getState().hierarchies["!A"]).toEqual(["!fr", "!cache", "!sous-espace"]);
});
it("rejoindre l'espace laisse tous ses salons au choix de l'utilisateur", async () => {
  mock.rejoindre.mockResolvedValue("!A");
  mock.hierarchy.mockResolvedValue({ rooms: [{ room_id: "!A", children_state: [child("!public")] }, { room_id: "!public", join_rule: "public" }] });
  expect(await rejoindreEspace("https://matrix.to/#/!A?via=remote.example")).toEqual({ id: "!A" });
  expect(mock.rejoindre.mock.calls).toEqual([["!A", ["remote.example"]]]);
  expect(mock.hierarchy).not.toHaveBeenCalled();
});
it("une hiérarchie reçue après un changement de compte n'est pas conservée", async () => {
  useEspacesStore.setState({ hierarchies: {} });
  mock.hierarchy.mockImplementationOnce(async () => {
    mock.utilisateur = "@autre:hs";
    return { rooms: [{ room_id: "!A", children_state: [child("!fr")] }, { room_id: "!fr" }] };
  });
  expect(await decouvrirSalonsEspace("!A")).toEqual([]);
  expect(useEspacesStore.getState().hierarchies).toEqual({});
});
it("partage une consultation en cours et garde sa liste pendant une minute", async () => {
  vi.useFakeTimers();
  mock.hierarchy.mockResolvedValue({ rooms: [{ room_id: "!A", children_state: [child("!fr")] }, { room_id: "!fr" }] });
  const listes = await Promise.all([decouvrirSalonsEspace("!A"), decouvrirSalonsEspace("!A")]);
  expect(listes[0]).toEqual(listes[1]);
  expect(mock.hierarchy).toHaveBeenCalledOnce();
  await decouvrirSalonsEspace("!A");
  expect(mock.hierarchy).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(60_001);
  await decouvrirSalonsEspace("!A");
  expect(mock.hierarchy).toHaveBeenCalledTimes(2);
});
it("un autre compte ne réutilise pas une liste privée du précédent", async () => {
  mock.hierarchy.mockResolvedValueOnce({ rooms: [{ room_id: "!A", children_state: [child("!prive")] }, { room_id: "!prive" }] })
    .mockResolvedValueOnce({ rooms: [{ room_id: "!A", children_state: [] }] });
  expect(await decouvrirSalonsEspace("!A")).toHaveLength(1);
  mock.utilisateur = "@autre:hs";
  expect(await decouvrirSalonsEspace("!A")).toEqual([]);
  expect(mock.hierarchy).toHaveBeenCalledTimes(2);
});
it("la modification des liens invalide la liste et une erreur n'empêche pas la reprise", async () => {
  mock.hierarchy.mockResolvedValue({ rooms: [{ room_id: "!A", children_state: [] }] });
  await decouvrirSalonsEspace("!A");
  await lierSalon("!A", "!nouveau", false);
  mock.hierarchy.mockRejectedValueOnce(new Error("réseau indisponible"));
  await expect(decouvrirSalonsEspace("!A")).rejects.toThrow("réseau indisponible");
  expect(await decouvrirSalonsEspace("!A")).toEqual([]);
  expect(mock.hierarchy).toHaveBeenCalledTimes(3);
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
it.each([false, true])("passes encryption to the Rust core for the selected space (voice: %s)", async (vocal) => {
  await creerSalonDansEspace("!A", "Private meeting", vocal, false, true);
  expect(mock.creerSalon).toHaveBeenCalledWith("Private meeting", vocal, false, true, "!A", false);
  expect(mock.envoyer).toHaveBeenCalledWith("!A", "m.space.child", "!nouveau", { via: ["sionchat.fr"], suggested: false });
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
  mock.details.mockImplementation(async (salon: string) => ({ moi: 100, niveauEtat: 50, membres: salon === "!A"
    ? [{ userId: "@moi:sionchat.fr" }, { userId: "@alice:hs" }]
    : [{ userId: "@moi:sionchat.fr", powerLevel: 100 }] }));
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

it("partage la création en cours et réutilise le salon après un échec de désignation", async () => {
  let rejeter = true;
  mock.envoyer.mockImplementation(async (_salon: string, type: string) => {
    if (type === "com.sion.space" && rejeter) throw new Error("publication refusée");
  });
  const tentatives = [creerBibliotheque("!creation-test"), creerBibliotheque("!creation-test")];
  await Promise.all(tentatives.map((p) => expect(p).rejects.toThrow("publication refusée")));
  expect(mock.creerSalon).toHaveBeenCalledTimes(1);
  rejeter = false;
  expect(await creerBibliotheque("!creation-test")).toMatchObject({ roomId: "!nouveau", echecs: [] });
  expect(mock.creerSalon).toHaveBeenCalledTimes(1);
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

it("lit les invitations persistantes de cet espace sans inclure les membres joints, les refus et les départs", async () => {
  mock.etats.mockResolvedValue([
    { stateKey: "@zoe:hs", content: { membership: "invite", displayname: "Zoé", avatar_url: "mxc://hs/photo" } },
    { stateKey: "@alice:ailleurs", content: { membership: "invite", displayname: " " } },
    ...["join", "leave", "ban", "knock"].map((membership) => ({ stateKey: `@${membership}:hs`, content: { membership } })),
  ]);
  expect(await invitationsEspace("!A")).toEqual([
    { userId: "@alice:ailleurs", displayName: "alice", avatarUrl: null },
    { userId: "@zoe:hs", displayName: "Zoé", avatarUrl: "sion-media://localhost/photo" },
  ]);
  expect(mock.etats).toHaveBeenCalledExactlyOnceWith("!A", "m.room.member");
  expect(mock.media).toHaveBeenCalledExactlyOnceWith("mxc://hs/photo");
  expect(mock.inviter).not.toHaveBeenCalled();
});

it("conserve une invitation quand la conversion de son avatar échoue", async () => {
  mock.etats.mockResolvedValue([{ stateKey: "@alice:hs", content: { membership: "invite", avatar_url: "mxc://hs/photo" } }]);
  mock.media.mockRejectedValue(new Error("média indisponible"));
  expect(await invitationsEspace("!A")).toEqual([{ userId: "@alice:hs", displayName: "alice", avatarUrl: null }]);
});

it("charge aussi les invitations dans le moteur JS", async () => {
  mock.rust = false;
  const charger = vi.fn().mockResolvedValue(undefined);
  const invites = vi.fn().mockReturnValue([{ userId: "@bob:hs", rawDisplayName: "Bob", getMxcAvatarUrl: () => "mxc://hs/photo" }]);
  mock.client = { getRoom: (id: string) => id === "!A" ? { loadMembersIfNeeded: charger, getMembersWithMembership: invites } : null };
  expect(await invitationsEspace("!A")).toEqual([{ userId: "@bob:hs", displayName: "Bob", avatarUrl: "https://media.test/photo" }]);
  expect(charger).toHaveBeenCalledOnce(); expect(invites).toHaveBeenCalledExactlyOnceWith("invite");
  expect(mock.etats).not.toHaveBeenCalled();
  await expect(invitationsEspace("!inconnu")).rejects.toThrow("spaces.notSpace");
});
