import { beforeEach, expect, it, vi } from "vitest";
import "../test/interface";
import { useMatrixStore } from "../stores/useMatrixStore";
import { ErreurApiAdmin } from "./matrixCore";
import { apercuConservation, CHEMIN_CONSERVATION, enregistrerConservation, lireConservation, politiqueValide } from "./conservationService";

const appels = vi.hoisted(() => ({ requete: vi.fn(), rust: true }));
vi.mock("../i18n", () => ({ default: { t: (s: string) => s } }));
vi.mock("./moteur", () => ({ moteurRust: () => appels.rust }));
vi.mock("./matrixService", () => ({ getMatrixClient: () => ({ getHomeserverUrl: () => "https://test.invalid/", getAccessToken: () => "jeton-de-test" }) }));
vi.mock("./matrixCore", async (original) => ({ ...await original<typeof import("./matrixCore")>(), requeteAdmin: appels.requete }));
const changement = [{ roomId: "!space:hs", policy: { mode: "days" as const, days: 90 } }];
beforeEach(() => {
  appels.rust = true; appels.requete.mockReset();
  useMatrixStore.setState({ currentUserId: "@admin:hs", channels: [
    { id: "!space:hs", name: "Equipe", isSpace: true, boardRoomId: "!board:hs", spaceChildren: ["!chat:hs", "!board:hs"], hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0 },
    ...["chat", "board"].map((id) => ({ id: `!${id}:hs`, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0 })),
  ] });
});
it("utilise le mandataire natif authentifié sans récupérer de jeton", async () => {
  appels.requete.mockResolvedValue({ available: true });
  await lireConservation("!space:hs");
  expect(appels.requete).toHaveBeenCalledExactlyOnceWith(CHEMIN_CONSERVATION, { methode: "POST", corps: { action: "read", scopeId: "!space:hs" }, authentifiee: true });
});
it("seule l'absence du service désactive les réglages et protège la bibliothèque", async () => {
  appels.requete.mockRejectedValue(new ErreurApiAdmin(404, "M_UNRECOGNIZED"));
  const v = await lireConservation("!space:hs");
  expect(v.available).toBe(false); expect(v.scope.editable).toBe(false);
  expect(v.rooms.find((r) => r.id === "!board:hs")?.protected).toBe(true);
});
it("affiche le service indisponible si le homeserver rejette le chemin inconnu avec un 403 sans erreur Matrix", async () => {
  appels.requete.mockRejectedValue(new ErreurApiAdmin(403));
  expect((await lireConservation("!space:hs")).available).toBe(false);
});
it.each([403, 500, 404])("un refus, une panne ou un salon disparu ne devient pas un service absent (%s)", async (status) => {
  appels.requete.mockRejectedValue(new ErreurApiAdmin(status, status === 404 ? "M_NOT_FOUND" : "M_FORBIDDEN"));
  await expect(lireConservation("!space:hs")).rejects.toBeInstanceOf(ErreurApiAdmin);
});
it("l'aperçu et l'enregistrement sont séparés, et la révision est obligatoire", async () => {
  appels.requete.mockResolvedValue({ revision: "revision-test" });
  await apercuConservation("!space:hs", changement);
  expect(appels.requete).toHaveBeenLastCalledWith(CHEMIN_CONSERVATION, expect.objectContaining({ corps: { action: "preview", scopeId: "!space:hs", changes: changement } }));
  await expect(enregistrerConservation("!space:hs", changement, "")).rejects.toThrow("previewRequired");
  await enregistrerConservation("!space:hs", changement, "revision-test");
  expect(appels.requete).toHaveBeenLastCalledWith(CHEMIN_CONSERVATION, expect.objectContaining({ corps: { action: "save", scopeId: "!space:hs", changes: changement, revision: "revision-test" } }));
});
it.each([0, -1, 1.5, 36501, NaN])("rejette une durée invalide avant toute requête (%s)", async (days) => {
  expect(politiqueValide({ mode: "days", days })).toBe(false);
  await expect(apercuConservation("!space:hs", [{ roomId: "!chat:hs", policy: { mode: "days", days } }])).rejects.toThrow("invalidPolicy");
  expect(appels.requete).not.toHaveBeenCalled();
});
it("ignore une réponse arrivée après un changement de compte", async () => {
  let finir!: (value: unknown) => void;
  appels.requete.mockImplementation(() => new Promise((resolve) => { finir = resolve; }));
  const reponse = lireConservation("!space:hs");
  useMatrixStore.setState({ currentUserId: "@autre:hs" }); finir({ available: true });
  await expect(reponse).rejects.toThrow("accountChanged");
});
it("accepte l'héritage depuis un espace Matrix v12 dont l'identifiant n'a pas de suffixe serveur", async () => {
  appels.requete.mockResolvedValue({ revision: "revision-test" });
  const policy = { mode: "inherit" as const, parent: "!identifiant-opaque-matrix" };
  expect(politiqueValide(policy)).toBe(true);
  await apercuConservation("!identifiant-opaque-matrix", [{ roomId: "!salon-opaque-matrix", policy }]);
  expect(appels.requete).toHaveBeenCalledOnce();
});
