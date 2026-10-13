import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { definirMoteur } from "../services/moteur";
import { fusionnerEchos } from "./echosMessages";

const envois = vi.hoisted(() => ({ texte: vi.fn(), reponse: vi.fn() }));
vi.mock("../services/matrixService", () => ({
  sendTextMessage: (...args: unknown[]) => envois.texte(...args),
  sendReply: (...args: unknown[]) => envois.reponse(...args),
  getRoomMemberInfo: () => ({ displayName: "Moi", avatarUrl: null }),
}));
vi.mock("../services/soundService", () => ({ playMessageReceived: vi.fn() }));
vi.mock("../services/voiceChannelSounds", () => ({ playPokeCue: vi.fn() }));
vi.mock("../services/adminCommandService", () => ({ findAdminRoom: vi.fn() }));
vi.mock("./useAppStore", () => ({ useAppStore: { getState: () => ({}), subscribe: vi.fn() } }));
vi.mock("./useSettingsStore", () => ({ useSettingsStore: { getState: () => ({}), subscribe: vi.fn() } }));
vi.mock("../utils/messageCache", () => ({ setCachedRoom: vi.fn(), appendCachedEventIds: vi.fn(), clearCache: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn() }));

import { useMatrixStore } from "./useMatrixStore";
beforeEach(() => {
  definirMoteur("rust");
  envois.texte.mockReset(); envois.reponse.mockReset();
  useMatrixStore.getState().reset();
  useMatrixStore.setState({ currentUserId: "@moi:hs" });
});
afterEach(() => definirMoteur("js"));
function attente() {
  let resolve!: (resultat: { event_id: string }) => void;
  let reject!: (erreur: Error) => void;
  const promise = new Promise<{ event_id: string }>((ok, non) => { resolve = ok; reject = non; });
  return { promise, resolve, reject };
}
it("montre le lien Steam avant toute réponse du serveur", async () => {
  const reseau = attente(); envois.texte.mockReturnValue(reseau.promise);
  const lien = "https://store.steampowered.com/app/4536610/City_Masterplan/";
  const envoi = useMatrixStore.getState().sendMessage("!salon", lien);
  const [local] = useMatrixStore.getState().messages["!salon"];
  expect(local).toMatchObject({ text: lien, sending: true, localEcho: true });
  expect(local.eventId).toBeUndefined();
  expect(envois.texte).toHaveBeenCalledWith("!salon", lien, local.transactionId);
  reseau.resolve({ event_id: "$1" }); await envoi;
  expect(useMatrixStore.getState().messages["!salon"][0]).toMatchObject({ eventId: "$1", sending: false });
});
it("conserve le contenu serveur quand la synchro devance l'accusé", async () => {
  const reseau = attente(); envois.texte.mockReturnValue(reseau.promise);
  const envoi = useMatrixStore.getState().sendMessage("!salon", "bonjour");
  const avant = useMatrixStore.getState().messages["!salon"];
  const recu = { ...avant[0], id: "$1", eventId: "$1", localEcho: undefined, sending: undefined, time: "12:01" };
  useMatrixStore.setState({ messages: { "!salon": fusionnerEchos(avant, [recu]) } });
  reseau.resolve({ event_id: "$1" }); await envoi;
  expect(useMatrixStore.getState().messages["!salon"]).toEqual([recu]);
});
it("retire uniquement l'écho raté et remonte l'erreur au brouillon", async () => {
  const un = attente(), deux = attente();
  envois.texte.mockReturnValueOnce(un.promise).mockReturnValueOnce(deux.promise);
  const premier = useMatrixStore.getState().sendMessage("!salon", "bonjour");
  const second = useMatrixStore.getState().sendMessage("!salon", "bonjour");
  const rejet = expect(premier).rejects.toThrow("hors ligne");
  un.reject(new Error("hors ligne")); await rejet;
  expect(useMatrixStore.getState().messages["!salon"]).toHaveLength(1);
  deux.resolve({ event_id: "$2" }); await second;
  expect(useMatrixStore.getState().messages["!salon"][0].eventId).toBe("$2");
});
it("ne restaure aucun salon si la session a été effacée pendant l'envoi", async () => {
  const reseau = attente(); envois.texte.mockReturnValue(reseau.promise);
  const envoi = useMatrixStore.getState().sendMessage("!salon", "bonjour");
  useMatrixStore.getState().reset();
  reseau.resolve({ event_id: "$1" }); await envoi;
  expect(useMatrixStore.getState().messages).toEqual({});
});
it("affiche également une réponse avant la confirmation réseau", async () => {
  const reseau = attente(); envois.reponse.mockReturnValue(reseau.promise);
  useMatrixStore.setState({ messages: { "!salon": [{ id: "$origine", eventId: "$origine", senderId: "@alice:hs", user: "Alice", role: "user", text: "salut", time: "12:00" }] } });
  const envoi = useMatrixStore.getState().sendReply("!salon", "$origine", "bonjour");
  const local = useMatrixStore.getState().messages["!salon"][1];
  expect(local.replyTo).toMatchObject({ eventId: "$origine", user: "Alice", text: "salut" });
  expect(envois.reponse).toHaveBeenCalledWith("!salon", "$origine", "bonjour", local.transactionId);
  reseau.resolve({ event_id: "$reponse" }); await envoi;
});
