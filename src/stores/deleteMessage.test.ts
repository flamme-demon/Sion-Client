import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types/matrix";
import type { FilSalon } from "../services/matrixCore";
import { definirMoteur } from "../services/moteur";

const mocks = vi.hoisted(() => ({ redact: vi.fn(), onMessages: undefined as ((fil: FilSalon) => void) | undefined }));
vi.mock("../services/matrixService", () => ({
  redactMessage: mocks.redact,
  resolveServerEventId: (_room: string, id: string) => id === "~local" ? "$photo" : null,
}));
vi.mock("../services/soundService", () => ({ playMessageReceived: vi.fn() }));
vi.mock("../services/voiceChannelSounds", () => ({ playPokeCue: vi.fn() }));
vi.mock("../services/adminCommandService", () => ({ findAdminRoom: vi.fn() }));
vi.mock("./useAppStore", () => ({ APP_SESSION_START_TS: Date.now(), useAppStore: { getState: () => ({}), subscribe: vi.fn() } }));
vi.mock("./useSettingsStore", () => ({ useSettingsStore: { getState: () => ({}), subscribe: vi.fn() } }));
vi.mock("./useEntreMembresStore", () => ({ useEntreMembresStore: { getState: () => ({ vider: vi.fn(), definirFrappe: vi.fn(), definirLectures: vi.fn() }) } }));
vi.mock("../utils/messageCache", () => ({ setCachedRoom: vi.fn(), appendCachedEventIds: vi.fn(), clearCache: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn() }));
vi.mock("../services/cacheRust", () => ({ surChangement: vi.fn(), definirSalons: vi.fn(), definirEpingles: () => false }));
vi.mock("../services/matrixCore", () => ({
  surEtat: vi.fn(), surSalons: vi.fn(), surVerification: vi.fn(), surEvenementsSion: vi.fn(), surFrappes: vi.fn(), surLectures: vi.fn(),
  surMessages: async (callback: (fil: FilSalon) => void) => { mocks.onMessages = callback; },
  etatConnexion: async () => ({ etat: "connexion" }), salons: async () => [], fils: async () => [], lectures: async () => [],
  verification: async () => ({ etape: "idle", emojis: [] }),
}));
import { useMatrixStore } from "./useMatrixStore";
import { demarrerMoteurRust } from "./moteurRustStore";
import { filtrerSuppressions } from "./suppressionsMessages";

const photo: ChatMessage = { id: "$photo", eventId: "$photo", senderId: "@moi:hs", user: "Moi", role: "user", text: "caption", time: "12:00", edited: true };
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  definirMoteur("rust");
  mocks.redact.mockReset().mockResolvedValue(undefined);
  useMatrixStore.getState().reset();
  useMatrixStore.setState({ currentUserId: "@moi:hs", messages: { "!room": [photo], "!other": [photo] } });
});
afterEach(() => definirMoteur("js"));

it("keeps an edited message deleted when an older native snapshot arrives", async () => {
  await demarrerMoteurRust(useMatrixStore.setState, useMatrixStore.getState);
  await useMatrixStore.getState().deleteMessage("!room", "$photo");
  mocks.onMessages!({ salon: "!room", messages: [photo], epingles: [], aPlus: false });
  expect(useMatrixStore.getState().messages["!room"]).toEqual([]);
  expect(useMatrixStore.getState().messages["!other"]).toEqual([photo]);
  await useMatrixStore.getState().deleteMessage("!room", "$photo");
  expect(mocks.redact).toHaveBeenCalledExactlyOnceWith("!room", "$photo");
});
it("shares one in-flight redaction between a local alias and its server ID", async () => {
  const request = deferred(); mocks.redact.mockReturnValue(request.promise);
  const first = useMatrixStore.getState().deleteMessage("!room", "~local");
  const second = useMatrixStore.getState().deleteMessage("!room", "$photo");
  expect(first).toBe(second);
  await Promise.resolve();
  expect(mocks.redact).toHaveBeenCalledExactlyOnceWith("!room", "$photo");
  expect(useMatrixStore.getState().messages["!room"]).toEqual([photo]);
  request.resolve(); await first;
  expect(filtrerSuppressions("!room", [{ ...photo, id: "~local", eventId: undefined }])).toEqual([]);
});
it("reports a failed redaction, retains the message and allows a retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.redact.mockRejectedValueOnce(Error("offline"));
    await expect(useMatrixStore.getState().deleteMessage("!room", "$photo")).rejects.toThrow("offline");
    expect(useMatrixStore.getState().messages["!room"]).toEqual([photo]);
    expect(filtrerSuppressions("!room", [photo])).toEqual([photo]);
    await useMatrixStore.getState().deleteMessage("!room", "$photo");
    expect(mocks.redact).toHaveBeenCalledTimes(2);
    expect(useMatrixStore.getState().messages["!room"]).toEqual([]);
  } finally { vi.restoreAllMocks(); }
});
it("ignores an old acknowledgement after signing back in with the same account", async () => {
  const request = deferred(); mocks.redact.mockReturnValueOnce(request.promise);
  const first = useMatrixStore.getState().deleteMessage("!room", "$photo");
  await Promise.resolve();
  useMatrixStore.getState().reset();
  useMatrixStore.setState({ currentUserId: "@moi:hs", messages: { "!room": [photo] } });
  request.resolve(); await first;
  expect(useMatrixStore.getState().messages["!room"]).toEqual([photo]);
  await useMatrixStore.getState().deleteMessage("!room", "$photo");
  expect(mocks.redact).toHaveBeenCalledTimes(2);
});
