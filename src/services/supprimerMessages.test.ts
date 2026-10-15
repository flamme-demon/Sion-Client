import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../test/interface";
import { useMatrixStore } from "../stores/useMatrixStore";
import { supprimerMessages } from "./supprimerMessages";
import type { ChatMessage } from "../types/matrix";

montage();
const serveur = vi.hoisted(() => ({ moi: 0, redact: 50, supprimer: vi.fn() }));
vi.mock("./matrixService", () => ({ getUserPowerLevel: () => serveur.moi, getRedactPowerLevel: () => serveur.redact, redactMessage: serveur.supprimer }));
const message = (id: string, senderId = "@moi:hs"): ChatMessage => ({ id, eventId: id, senderId, user: senderId, role: "user", text: "Texte", time: "12:00" });
beforeEach(() => {
  useMatrixStore.getState().reset();
  vi.clearAllMocks(); serveur.moi = 0; serveur.redact = 50; serveur.supprimer.mockResolvedValue(undefined);
  useMatrixStore.setState({ currentUserId: "@moi:hs", messages: { "!salon": [message("$1"), message("$2"), message("$3", "@alice:hs")], "!autre": [message("$autre")] } });
});
it("supprime uniquement les événements sélectionnés, en dédoublonnant", async () => {
  const resultat = await supprimerMessages("!salon", ["$1", "$2", "$1"]);
  expect(serveur.supprimer.mock.calls).toEqual([["!salon", "$1"], ["!salon", "$2"]]);
  expect(resultat).toEqual({ supprimes: ["$1", "$2"], echecs: [], interrompu: false });
  expect(useMatrixStore.getState().messages["!salon"].map((m) => m.id)).toEqual(["$3"]);
  expect(useMatrixStore.getState().messages["!autre"]).toHaveLength(1);
});
it("conserve les échecs et permet de reprendre sans répéter les succès", async () => {
  serveur.supprimer.mockRejectedValueOnce(Error("Serveur indisponible"));
  expect(await supprimerMessages("!salon", ["$1", "$2"])).toEqual({ supprimes: ["$2"], echecs: ["$1"], interrompu: false });
  expect(useMatrixStore.getState().messages["!salon"].map((m) => m.id)).toEqual(["$1", "$3"]);
  await supprimerMessages("!salon", ["$1"]);
  expect(serveur.supprimer.mock.calls.at(-1)).toEqual(["!salon", "$1"]);
});
it("un membre ne supprime pas ceux des autres ; un modérateur utilise le niveau redact", async () => {
  expect((await supprimerMessages("!salon", ["$3"])).echecs).toEqual(["$3"]);
  expect(serveur.supprimer).not.toHaveBeenCalled();
  serveur.moi = 50; serveur.redact = 75;
  expect((await supprimerMessages("!salon", ["$3"])).echecs).toEqual(["$3"]);
  serveur.moi = 75;
  expect((await supprimerMessages("!salon", ["$3"])).supprimes).toEqual(["$3"]);
});
it("arrête le lot si le compte change et ne modifie pas le fil de la nouvelle session", async () => {
  serveur.supprimer.mockImplementationOnce(async () => { useMatrixStore.setState({ currentUserId: "@nouveau:hs", messages: { "!salon": [message("$nouveau")] } }); });
  expect((await supprimerMessages("!salon", ["$1", "$2"])).interrompu).toBe(true);
  expect(serveur.supprimer).toHaveBeenCalledExactlyOnceWith("!salon", "$1");
  expect(useMatrixStore.getState().messages["!salon"][0].id).toBe("$nouveau");
});
it("recontrôle les droits entre les suppressions", async () => {
  serveur.moi = 50;
  useMatrixStore.setState({ messages: { "!salon": [message("$1", "@alice:hs"), message("$2", "@alice:hs")] } });
  serveur.supprimer.mockImplementationOnce(async () => { serveur.moi = 0; });
  expect(await supprimerMessages("!salon", ["$1", "$2"])).toEqual({ supprimes: ["$1"], echecs: ["$2"], interrompu: false });
  expect(serveur.supprimer).toHaveBeenCalledExactlyOnceWith("!salon", "$1");
});
it("ne prétend pas supprimer un événement sorti du fil chargé", async () => {
  expect(await supprimerMessages("!salon", ["$inconnu"])).toEqual({ supprimes: [], echecs: ["$inconnu"], interrompu: false });
  expect(serveur.supprimer).not.toHaveBeenCalled();
});
