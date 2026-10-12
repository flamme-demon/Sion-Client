import { expect, it } from "vitest";
import type { Channel } from "../types/matrix";
import { planDepartEspace } from "./departEspace";
const salon = (id: string, reste: Partial<Channel> = {}): Channel => ({
  id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...reste,
});
it("inclut la bibliothèque désignée, les descendants rejoints et protège les MP", () => {
  const channels = [salon("!A", { isSpace: true, spaceChildren: ["!texte", "!sous", "!mp", "!invite", "!non-rejoint"], boardRoomId: "!board" }),
    salon("!sous", { isSpace: true, spaceChildren: ["!vocal"] }), salon("!texte"), salon("!vocal", { hasVoice: true }),
    salon("!mp", { isDM: true }), salon("!invite", { membership: "invite" }), salon("!board", { isSoundboard: true })];
  expect(planDepartEspace(channels, "!A").map((p) => p.salon.id)).toEqual(["!texte", "!vocal", "!sous", "!board"]);
  expect(planDepartEspace(channels, "!A").every((p) => p.partageAvec.length === 0)).toBe(true);
});
it("conserve les salons, sous-espaces et bibliothèques partagés avec une autre équipe rejointe", () => {
  const channels = [salon("!A", { isSpace: true, spaceChildren: ["!propre", "!sous"], boardRoomId: "!board" }),
    salon("!B", { isSpace: true, spaceChildren: ["!sous"], boardRoomId: "!board" }),
    salon("!sous", { isSpace: true, spaceChildren: ["!commun"] }),
    salon("!propre"), salon("!commun"), salon("!board", { isSoundboard: true })];
  const plan = planDepartEspace(channels, "!A");
  expect(plan.filter((p) => p.partageAvec.length).map((p) => p.salon.id)).toEqual(["!commun", "!sous", "!board"]);
  expect(plan.find((p) => p.salon.id === "!commun")?.partageAvec.map((p) => p.id)).toEqual(["!B"]);
});
it("retrouve un salon rejoint dans un sous-espace exploré sans imposer l'adhésion à celui-ci", () => {
  const channels = [salon("!A", { isSpace: true, spaceChildren: ["!sous"] }), salon("!fr")];
  expect(planDepartEspace(channels, "!A", { "!sous": ["!fr", "!A"] }).map((p) => p.salon.id)).toEqual(["!fr"]);
});
it("ignore les anciennes relations d'un espace et les espaces dont l'invitation n'est pas acceptée", () => {
  const channels = [salon("!A", { isSpace: true, spaceChildren: ["!texte"] }),
    salon("!invite", { isSpace: true, membership: "invite", spaceChildren: ["!texte"] }), salon("!texte"), salon("!retire")];
  const plan = planDepartEspace(channels, "!A", { "!A": ["!retire"] });
  expect(plan.map((p) => p.salon.id)).toEqual(["!texte"]);
  expect(plan[0].partageAvec).toEqual([]);
});
