import { expect, it } from "vitest";
import type { Channel } from "../types/matrix";
import { contexteBibliotheque } from "./bibliotheque";

const salon = (id: string, reste: Partial<Channel> = {}): Channel => ({
  id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...reste,
});
const equipe = [
  salon("!sion", { isSpace: true, spaceChildren: ["!vocal"], boardRoomId: "!board" }),
  salon("!manjaro", { isSpace: true, spaceChildren: ["!general"] }),
  salon("!vocal", { hasVoice: true }), salon("!general"),
];

it("garde la bibliothèque du vocal pendant la navigation dans un autre espace", () => {
  expect(contexteBibliotheque(equipe, "!manjaro", "!vocal").espaceId).toBe("!sion");
  expect(contexteBibliotheque(equipe, null, "!vocal")).toEqual(
    contexteBibliotheque(equipe, "!sion", "!vocal"));
});
it("revient à l'espace consulté dès que le vocal est quitté", () => {
  expect(contexteBibliotheque(equipe, "!manjaro", null)).toEqual({
    espaceId: "!manjaro", vocalId: null, indisponible: false,
  });
});
it("un vocal d'une autre équipe sans bibliothèque n'hérite pas de celle de Sion", () => {
  const channels = [...equipe, salon("!autre", { isSpace: true, spaceChildren: ["!autre-vocal"] }),
    salon("!autre-vocal", { hasVoice: true })];
  expect(contexteBibliotheque(channels, "!sion", "!autre-vocal").espaceId).toBe("!autre");
});
it("retrouve la bibliothèque d'un ancêtre pour un vocal dans un sous-espace exploré", () => {
  const channels = [salon("!racine", { isSpace: true, spaceChildren: ["!sous"], boardRoomId: "!board" }),
    salon("!vocal", { hasVoice: true })];
  expect(contexteBibliotheque(channels, "!manjaro", "!vocal", { "!sous": ["!vocal", "!racine"] })
    .espaceId).toBe("!racine");
});
it("préfère la bibliothèque du sous-espace à celle de son ancêtre", () => {
  const channels = [salon("!racine", { isSpace: true, spaceChildren: ["!sous"], boardRoomId: "!board-racine" }),
    salon("!sous", { isSpace: true, spaceChildren: ["!vocal"], boardRoomId: "!board-sous" }),
    salon("!vocal", { hasVoice: true })];
  expect(contexteBibliotheque(channels, "!racine", "!vocal").espaceId).toBe("!sous");
});
it("un salon lié à plusieurs espaces conserve la même source pendant la navigation", () => {
  const channels = [...equipe, salon("!autre", { isSpace: true, spaceChildren: ["!vocal"], boardRoomId: "!board-autre" })];
  const premier = contexteBibliotheque(channels, "!sion", "!vocal");
  expect(contexteBibliotheque([...channels].reverse(), "!autre", "!vocal")).toEqual(premier);
});
it.each([{ channels: [] }, { channels: [salon("!vocal", { membership: "invite" })] },
  { channels: [salon("!vocal", { isDM: true })] }])(
  "attend un vocal connu et rejoint plutôt que diffuser une bibliothèque étrangère", ({ channels }) => {
    expect(contexteBibliotheque([...equipe.filter((c) => c.id !== "!vocal"), ...channels], "!sion", "!vocal"))
      .toEqual({ espaceId: null, vocalId: "!vocal", indisponible: true });
  });
it("un vocal non rattaché à un espace conserve la bibliothèque historique du serveur", () => {
  expect(contexteBibliotheque([...equipe, salon("!libre")], "!sion", "!libre"))
    .toEqual({ espaceId: null, vocalId: "!libre", indisponible: false });
});
