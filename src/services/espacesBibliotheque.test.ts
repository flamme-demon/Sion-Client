import { beforeEach, expect, it, vi } from "vitest";
import { findSoundboardRoom } from "./matrixService";
import { useEspacesStore } from "../stores/useEspacesStore";
import type { Channel } from "../types/matrix";
const mocks = vi.hoisted(() => ({ salons: [] as Channel[], vocal: null as string | null, etats: vi.fn(), legacy: vi.fn() }));
const salon = (id: string, reste: Partial<Channel> = {}): Channel => ({
  id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...reste,
});
vi.mock("./moteur", () => ({ moteurRust: () => true }));
vi.mock("./matrixCore", () => ({ etats: mocks.etats, salonSoundboard: mocks.legacy }));
vi.mock("../stores/useMatrixStore", () => ({ useMatrixStore: { getState: () => ({ channels: mocks.salons }) } }));
vi.mock("../stores/useAppStore", () => ({ useAppStore: { getState: () => ({ connectedVoiceChannel: mocks.vocal }) } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.vocal = null;
  mocks.salons = [salon("!A", { isSpace: true, boardRoomId: "!boardA", spaceChildren: ["!vocalA"] }),
    salon("!B", { isSpace: true, boardRoomId: "!boardB", spaceChildren: ["!vocalB"] }),
    salon("!vocalA", { hasVoice: true }), salon("!vocalB", { hasVoice: true })];
  mocks.etats.mockResolvedValue([]); mocks.legacy.mockResolvedValue("!global");
  useEspacesStore.setState({ espaceActif: null, hierarchies: {}, espaceVocalConserve: null });
});
it("change de bibliothèque quand on change d'équipe", async () => {
  useEspacesStore.getState().choisir("!A"); expect(await findSoundboardRoom()).toBe("!boardA");
  useEspacesStore.getState().choisir("!B"); expect(await findSoundboardRoom()).toBe("!boardB");
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("un Espace sans bibliothèque reste vide au lieu de récupérer celle du serveur", async () => {
  mocks.salons.push(salon("!vide", { isSpace: true }));
  useEspacesStore.getState().choisir("!vide"); expect(await findSoundboardRoom()).toBeNull();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("utilise la désignation Matrix même si la liste locale n'a pas encore reçu son état", async () => {
  mocks.salons.push(salon("!nouveau", { isSpace: true }));
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
it("les boards suivent le vocal pendant que l'administration suit l'espace consulté", async () => {
  mocks.vocal = "!vocalA";
  useEspacesStore.getState().choisir("!B");
  expect(await findSoundboardRoom("vocal")).toBe("!boardA");
  expect(await findSoundboardRoom()).toBe("!boardB");
  mocks.vocal = "!vocalB";
  expect(await findSoundboardRoom("vocal")).toBe("!boardB");
});
it("la fin du vocal rétablit la bibliothèque de l'espace consulté", async () => {
  mocks.vocal = "!vocalA";
  useEspacesStore.getState().choisir("!B");
  expect(await findSoundboardRoom("vocal")).toBe("!boardA");
  mocks.vocal = null;
  expect(await findSoundboardRoom("vocal")).toBe("!boardB");
});
it("le vocal sans bibliothèque ne prend pas celle de l'espace consulté ni du serveur", async () => {
  mocks.salons.push(salon("!vide", { isSpace: true, spaceChildren: ["!vocalVide"] }), salon("!vocalVide"));
  mocks.vocal = "!vocalVide";
  useEspacesStore.getState().choisir("!A");
  expect(await findSoundboardRoom("vocal")).toBeNull();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("attend la synchronisation d'un vocal inconnu sans récupérer une autre bibliothèque", async () => {
  mocks.vocal = "!inconnu";
  useEspacesStore.getState().choisir("!A");
  expect(await findSoundboardRoom("vocal")).toBeNull();
  expect(mocks.etats).not.toHaveBeenCalled();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it("conserve la bibliothèque de l'appel après un départ de l'espace sans quitter ses salons", async () => {
  const espace = mocks.salons.find((c) => c.id === "!A")!;
  mocks.salons = mocks.salons.filter((c) => c.id !== "!A");
  mocks.vocal = "!vocalA";
  useEspacesStore.setState({ espaceActif: "!B", espaceVocalConserve: { vocal: mocks.vocal, espace } });
  expect(await findSoundboardRoom("vocal")).toBe("!boardA");
  expect(await findSoundboardRoom()).toBe("!boardB");
  mocks.vocal = null;
  expect(await findSoundboardRoom("vocal")).toBe("!boardB");
});
