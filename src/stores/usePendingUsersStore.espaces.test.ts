import { expect, it, vi } from "vitest";
import { getPublicRoomIds } from "./usePendingUsersStore";
import { useEspacesStore } from "./useEspacesStore";
const data = vi.hoisted(() => ({ channels: [
  { id: "!A", isSpace: true, spaceChildren: ["!communA", "!priveA", "!boardA"], commonRoomIds: ["!communA", "!hors-espace"], boardRoomId: "!boardA" },
  { id: "!B", isSpace: true, spaceChildren: ["!communB"], commonRoomIds: ["!communB"] },
] }));
vi.mock("./useMatrixStore", () => ({ useMatrixStore: { getState: () => data } }));
vi.mock("../services/moteur", () => ({ moteurRust: () => true }));
vi.mock("../services/matrixService", () => ({ getMatrixClient: () => null }));
vi.mock("../services/adminCommandService", () => ({ findAdminRoom: () => null, sendAdminCommand: vi.fn(), parseUserList: vi.fn(), compteAnnonceInscrit: vi.fn() }));
vi.mock("../services/adminService", () => ({ checkUserSuspended: vi.fn() }));
it("la moulinette prend seulement l'Espace sélectionné, ses communs et sa bibliothèque", () => {
  useEspacesStore.getState().choisir("!A"); expect(getPublicRoomIds()).toEqual(["!A", "!communA", "!boardA"]);
  useEspacesStore.getState().choisir("!B"); expect(getPublicRoomIds()).toEqual(["!B", "!communB"]);
  useEspacesStore.getState().choisir(null); expect(getPublicRoomIds()).toEqual([]);
});
