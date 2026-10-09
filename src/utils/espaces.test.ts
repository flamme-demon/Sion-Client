import { expect, it } from "vitest";
import { adresseEspace, salonCommun, salonsDansEspace } from "./espaces";
import type { Channel } from "../types/matrix";
const salon = (id: string, reste = {}): Channel => ({ id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...reste });
it("conserve les via des liens de partage et les ID opaques v12", () => {
  expect(adresseEspace("https://matrix.to/#/%21Opaque?via=sionchat.fr&via=team.example&via=sionchat.fr")).toEqual({ adresse: "!Opaque", via: ["sionchat.fr", "team.example"] });
  expect(adresseEspace("#equipe:autre.example").adresse).toBe("#equipe:autre.example");
  expect(adresseEspace("matrix:roomid/Opaque?via=remote.example")).toEqual({ adresse: "!Opaque", via: ["remote.example"] });
});
it("rejette les URL étrangères et les identifiants incomplets", () => {
  for (const adresse of ["https://example.com/space", "#equipe", "", "!abc?commande=true", "https://matrix.to/#/!abc?via=a/b"]) expect(() => adresseEspace(adresse)).toThrow();
});
it("une autorisation restreinte à une autre équipe ne devient pas un salon commun", () => {
  expect(salonCommun({ join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: "!A" }] }, "!A")).toBe(true);
  expect(salonCommun({ join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: "!B" }] }, "!A")).toBe(false);
  expect(salonCommun({ join_rule: "invite" }, "!A")).toBe(false);
});
it("sépare les équipes, les MP, les bibliothèques et les salons non rattachés", () => {
  const rooms = [salon("!A", { isSpace: true, spaceChildren: ["!a", "!board"] }), salon("!B", { isSpace: true, spaceChildren: ["!b"] }), salon("!a"), salon("!b"), salon("!libre"), salon("!mp", { isDM: true }), salon("!board", { isSoundboard: true })];
  expect(salonsDansEspace(rooms, "!A").map((c) => c.id)).toEqual(["!a"]);
  expect(salonsDansEspace(rooms, "!B").map((c) => c.id)).toEqual(["!b"]);
  expect(salonsDansEspace(rooms, null).map((c) => c.id)).toEqual(["!libre"]);
});
