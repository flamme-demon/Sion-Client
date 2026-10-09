import { expect, it } from "vitest";
import { classerSalonsServeur, lireListeSalonsServeur } from "./salonsServeur";
import type { Channel } from "../types/matrix";
const salon = (id: string, extra: Partial<Channel> = {}): Channel => ({ id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...extra });
it("classe les Espaces, salons, MP et bibliothèques avec leurs noms et leurs parents", () => {
  const channels = [salon("!A", { name: "Equipe A", isSpace: true, spaceChildren: ["!general", "!board"], boardRoomId: "!board" }),
    salon("!general", { name: "Général", hasVoice: true }), salon("!mp", { name: "Alice", isDM: true })];
  const liste = lireListeSalonsServeur({ rooms: ["!A", "!general", "!mp", "!board", "!inconnu", "!admin"] });
  const resultat = classerSalonsServeur(liste, channels, [], new Set(), "!admin");
  expect(resultat.find((r) => r.id === "!A")?.type).toBe("espaces");
  expect(resultat.find((r) => r.id === "!general")).toMatchObject({ type: "salons", name: "Général", hasVoice: true, espaceNoms: ["Equipe A"] });
  expect(resultat.find((r) => r.id === "!mp")).toMatchObject({ type: "mp", name: "Alice" });
  expect(resultat.find((r) => r.id === "!board")).toMatchObject({ type: "bibliotheques", espaceNoms: ["Equipe A"] });
  expect(resultat.find((r) => r.id === "!inconnu")?.type).toBe("autres");
  expect(resultat.some((r) => r.id === "!admin")).toBe(false);
});
it("récupère les noms et types des éléments non rejoints sans les déduire de leur ID", () => {
  const liste = lireListeSalonsServeur({ rooms: ["!opaque", { room_id: "!remote", name: "Equipe distante", room_type: "m.space" }] });
  const resultat = classerSalonsServeur(liste, [], [{ id: "!opaque", name: "Projet", roomType: "m.voice_channel" }]);
  expect(resultat.find((r) => r.id === "!remote")).toMatchObject({ type: "espaces", name: "Equipe distante" });
  expect(resultat.find((r) => r.id === "!opaque")).toMatchObject({ type: "salons", name: "Projet", hasVoice: true });
});
it("reconnaît un MP via m.direct, même s'il n'est plus dans la liste des salons rejoints", () => {
  const resultat = classerSalonsServeur([{ id: "!mp" }], [], [], new Set(["!mp"]));
  expect(resultat[0].type).toBe("mp");
});
it("déduplique les IDs et rejette une réponse invalide plutôt que d'afficher une liste vide", () => {
  expect(lireListeSalonsServeur({ rooms: ["!A", "!A", null, 123, { name: "Sans ID" }] })).toEqual([{ id: "!A" }]);
  expect(() => lireListeSalonsServeur({ error: "M_FORBIDDEN" })).toThrow("roomsLoadFailed");
});
