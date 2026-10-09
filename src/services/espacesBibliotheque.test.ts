import { beforeEach, expect, it, vi } from "vitest";
import { findSoundboardRoom } from "./matrixService";
import { useEspacesStore } from "../stores/useEspacesStore";
const mocks = vi.hoisted(() => ({ salons: [] as { id: string; isSpace?: boolean; boardRoomId?: string }[], etats: vi.fn(), legacy: vi.fn() }));
vi.mock("./moteur", () => ({ moteurRust: () => true }));
vi.mock("./matrixCore", () => ({ etats: mocks.etats, salonSoundboard: mocks.legacy }));
vi.mock("../stores/useMatrixStore", () => ({ useMatrixStore: { getState: () => ({ channels: mocks.salons }) } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.salons = [{ id: "!A", isSpace: true, boardRoomId: "!boardA" }, { id: "!B", isSpace: true, boardRoomId: "!boardB" }];
  mocks.etats.mockResolvedValue([]); mocks.legacy.mockResolvedValue("!global");
  useEspacesStore.setState({ espaceActif: null });
});
it("change de bibliothèque quand on change d'équipe", async () => {
  useEspacesStore.getState().choisir("!A"); expect(await findSoundboardRoom()).toBe("!boardA");
  useEspacesStore.getState().choisir("!B"); expect(await findSoundboardRoom()).toBe("!boardB");
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("un Espace sans bibliothèque reste vide au lieu de récupérer celle du serveur", async () => {
  mocks.salons.push({ id: "!vide", isSpace: true });
  useEspacesStore.getState().choisir("!vide"); expect(await findSoundboardRoom()).toBeNull();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("utilise la désignation Matrix même si la liste locale n'a pas encore reçu son état", async () => {
  mocks.salons.push({ id: "!nouveau", isSpace: true });
  mocks.etats.mockResolvedValue([{ stateKey: "", content: { board_room_id: "!nouvelle-bibliotheque" } }]);
  useEspacesStore.getState().choisir("!nouveau"); expect(await findSoundboardRoom()).toBe("!nouvelle-bibliotheque");
  expect(mocks.etats).toHaveBeenCalledWith("!nouveau", "com.sion.space");
});
it("une résolution commencée dans A ne retourne pas la bibliothèque de B après navigation", async () => {
  useEspacesStore.getState().choisir("!A");
  const resultat = findSoundboardRoom();
  useEspacesStore.getState().choisir("!B");
  expect(await resultat).toBe("!boardA");
});
it("la bibliothèque migrée cesse d'apparaître dans l'accueil du serveur", async () => {
  mocks.legacy.mockResolvedValue("!boardA");
  expect(await findSoundboardRoom()).toBeNull();
});
