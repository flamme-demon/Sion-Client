import "../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { listMemes, envoyerMeme, modifierMeme, type MemePrepare } from "./memeboardService";

const contexte = vi.hoisted(() => ({
  rust: false, evenements: [] as unknown[], memes: [] as unknown[],
  envoyer: vi.fn(), envoyerRust: vi.fn(), modifierRust: vi.fn(),
}));
vi.mock("./moteur", () => ({ moteurRust: () => contexte.rust }));
vi.mock("./matrixCore", () => ({
  memes: async () => contexte.memes, envoyerMeme: contexte.envoyerRust, modifierMeme: contexte.modifierRust,
}));
vi.mock("./matrixService", () => ({
  getMatrixClient: () => ({ getRoom: () => ({}), sendEvent: contexte.envoyer }),
  findSoundboardRoom: async () => "!memes", uploadFile: async () => "mxc://hs/video",
  mxcToHttp: () => null,
}));
vi.mock("./soundboardService", () => ({ fetchSoundboardMessages: async () => contexte.evenements }));
vi.mock("./videoPrepare", () => ({ readMediaBytes: async () => new Uint8Array([1, 2, 3]) }));

const evenement = (id: string, category?: unknown) => ({
  getId: () => id, getSender: () => "@alice:hs", getTs: () => 1,
  getContent: () => ({ url: "mxc://hs/m", body: "m.mp4", "com.sion.meme": { label: "Chat", category } }),
});
const prepare: MemePrepare = { video: "/tmp/meme.mp4", mime: "video/mp4", taille: 3, largeur: 160, hauteur: 160, duree_ms: 1000, apercu: null, apercu_mime: null };
beforeEach(() => {
  contexte.rust = false;
  contexte.evenements = [];
  contexte.memes = [];
  contexte.envoyer.mockReset().mockResolvedValue({ event_id: "$m" });
  contexte.envoyerRust.mockReset().mockResolvedValue("$m");
  contexte.modifierRust.mockReset().mockResolvedValue(undefined);
});

it("les anciens mèmes et les catégories invalides sont rangés dans Autre", async () => {
  contexte.evenements = [evenement("$ancien"), evenement("$vide", " / "), evenement("$invalide", 42), evenement("$cat", " Films // Comédie ")];
  expect((await listMemes()).map((m) => [m.eventId, m.category])).toEqual([
    ["$ancien", "Autre"], ["$vide", "Autre"], ["$invalide", "Autre"], ["$cat", "Films/Comédie"],
  ]);
});

it("reste compatible avec le binaire natif précédent, sans champ category", async () => {
  contexte.rust = true;
  contexte.memes = [{ eventId: "$ancien" }, { eventId: "$cat", category: " Films / Comédie " }];
  expect((await listMemes()).map((m) => m.category)).toEqual(["Autre", "Films/Comédie"]);
});

it("l'import JS enregistre la catégorie dans le message Matrix partagé", async () => {
  await envoyerMeme(prepare, "Chat", "🐱", " Animaux / Chats ");
  expect(contexte.envoyer).toHaveBeenCalledWith("!memes", "m.room.message", expect.objectContaining({
    url: "mxc://hs/video", "com.sion.meme": { label: "Chat", category: "Animaux/Chats", emoji: "🐱", gain_pct: 100 },
  }));
});

it("envoi et édition natifs transmettent le chemin normalisé ; une édition historique conserve la catégorie", async () => {
  contexte.rust = true;
  await envoyerMeme(prepare, "Chat", null, " Animaux / Chats ");
  expect(contexte.envoyerRust).toHaveBeenCalledWith(prepare, "Chat", null, "Animaux/Chats", "!memes");
  await modifierMeme("$m", "Chat", null, " Films / Comédie ");
  expect(contexte.modifierRust).toHaveBeenLastCalledWith("$m", "Chat", null, "Films/Comédie", "!memes");
  await modifierMeme("$m", "Matou", null);
  expect(contexte.modifierRust).toHaveBeenLastCalledWith("$m", "Matou", null, undefined, "!memes");
});
