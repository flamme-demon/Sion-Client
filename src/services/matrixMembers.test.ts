import "../test/interface";
import { afterEach, expect, it, vi } from "vitest";
import { __setMatrixClientForTest, getRoomMembers } from "./matrixService";
import { definirMoteur } from "./moteur";

const details = vi.hoisted(() => ({ lire: vi.fn() }));
vi.mock("./cacheRust", () => ({ detailsSalon: details.lire }));

afterEach(() => { definirMoteur("js"); __setMatrixClientForTest(null); });

it("ignore le statut offline initial du SDK tant qu'aucun événement de présence n'est reçu", () => {
  definirMoteur("js");
  const users: Record<string, { presence: string; events: { presence: object | null } }> = {
    "@absent:hs": { presence: "offline", events: { presence: null } },
    "@actif:hs": { presence: "online", events: { presence: {} } },
    "@inactif:hs": { presence: "offline", events: { presence: {} } },
    "@inconnu:hs": { presence: "inconnu", events: { presence: {} } },
  };
  const client = {
    getUser: (id: string) => users[id], getHomeserverUrl: () => "https://hs",
    getRoom: () => ({ getJoinedMembers: () => Object.keys(users).map((userId) => ({ userId, name: userId, getAvatarUrl: () => null })) }),
  } as unknown as Parameters<typeof __setMatrixClientForTest>[0];
  __setMatrixClientForTest(client);
  expect(getRoomMembers("!salon").map((m) => m.presence)).toEqual([undefined, "online", "offline", undefined]);
});

it("conserve la présence du cœur et reste compatible avec le binaire sans ce champ", () => {
  definirMoteur("rust");
  details.lire.mockReturnValue({ membres: [
    { userId: "@actif:hs", displayName: "Actif", avatarUrl: null, presence: "unavailable" },
    { userId: "@sans:hs", displayName: "Sans présence", avatarUrl: null },
  ] });
  expect(getRoomMembers("!salon").map((m) => m.presence)).toEqual(["unavailable", undefined]);
});
