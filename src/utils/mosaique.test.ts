import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/matrix";
import { groupesImages, lignesMosaique, ratioImage } from "./mosaique";

const debut = new Date(2026, 9, 11, 12).getTime();
const image = (id: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `$${id}`, eventId: `$${id}`, senderId: "@alice:matrix.org", user: "Alice", role: "user",
  time: "12:00", ts: debut + id * 1000, text: "", msgtype: "m.image",
  attachments: [{ id: `$${id}`, name: `${id}.jpg`, mimeType: "image/jpeg", size: 120, url: `https://media.invalid/${id}` }],
  ...extra,
});
const tailles = (messages: ChatMessage[], nonLus?: number) => groupesImages(messages, nonLus).map((g) => g.messages.length);

describe("mosaïque des images de tous les clients Matrix", () => {
  it("groupe sans marqueur Sion, sans altérer les événements et les réactions", () => {
    const messages = [image(1), image(2, { reactions: [{ emoji: "😂", count: 1, userIds: ["@bob:hs"], eventIds: { "@bob:hs": "$r" } }] }), image(3)];
    const copie = structuredClone(messages);
    const groupes = groupesImages(messages);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].debut).toBe(0);
    expect(groupes[0].messages[1]).toBe(messages[1]);
    expect(messages).toEqual(copie);
  });
  it("limite chaque mosaïque à dix images", () => {
    expect(tailles(Array.from({ length: 21 }, (_, i) => image(i)))).toEqual([10, 10, 1]);
  });
  it("construit des rangées compactes sans perdre une image ni son ordre", () => {
    for (let n = 2; n <= 10; n++) {
      const images = Array.from({ length: n }, (_, i) => image(i));
      const lignes = lignesMosaique(images);
      expect(lignes.flat()).toEqual(images);
      expect(lignes.every((l) => l.length >= 1 && l.length <= 3)).toBe(true);
    }
    const paysage = image(1); paysage.attachments![0].width = 1600; paysage.attachments![0].height = 900;
    expect(ratioImage(paysage)).toBeCloseTo(16 / 9);
    expect(ratioImage(image(2))).toBe(1);
  });
  it("sépare les auteurs même quand leurs pseudos sont identiques", () => {
    expect(tailles([image(1), image(2, { senderId: "@alice:autre.org" }), image(3)])).toEqual([1, 1, 1]);
  });
  it.each([
    { text: "Une légende" }, { formattedBody: "<b>Une légende</b>" }, { edited: true },
    { replyTo: { eventId: "$origine" } }, { senderId: undefined }, { eventId: undefined }, { ts: undefined }, { ts: NaN },
    { attachments: [{ id: "$2", name: "film.mp4", mimeType: "video/mp4", size: 20, url: "https://media.invalid/2" }] },
  ])("laisse une image ou un autre média avec contexte à part : %j", (extra) => {
    expect(tailles([image(1), image(2, extra), image(3)])).toEqual([1, 1, 1]);
  });
  it("ne traverse ni un texte ni le repère des non-lus", () => {
    expect(tailles([image(1), image(2, { text: "Interruption", attachments: undefined }), image(3)])).toEqual([1, 1, 1]);
    expect(tailles([image(1), image(2), image(3), image(4)], 2)).toEqual([2, 2]);
  });
  it("sépare les envois espacés, inversés ou sur deux jours", () => {
    expect(tailles([image(1), image(2, { ts: debut + 62_000 })])).toEqual([1, 1]);
    expect(tailles([image(2), image(1)])).toEqual([1, 1]);
    const minuit = new Date(2026, 9, 12).getTime();
    expect(tailles([image(1, { ts: minuit - 1000 }), image(2, { ts: minuit })])).toEqual([1, 1]);
    expect(tailles([0, 60_000, 120_000, 180_000, 240_000].map((ts, i) => image(i, { ts: debut + ts })))).toEqual([4, 1]);
  });
});
