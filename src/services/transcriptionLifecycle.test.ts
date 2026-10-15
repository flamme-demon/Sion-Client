/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  app: { connectedVoiceChannel: "!voice:hs", isMuted: false, isDeafened: false },
  listeners: new Set<(state: unknown, prev: unknown) => void>(),
  segment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../stores/useAppStore", () => ({ useAppStore: {
  getState: () => mocks.app,
  subscribe: (listener: (state: unknown, prev: unknown) => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
} }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: {
  getState: () => ({ transcribeModel: "parakeet", transcribeLang: "fr" }),
} }));
vi.mock("./voiceNativeService", () => ({ voiceNativePublishData: vi.fn(), bytesToB64: () => "" }));
vi.mock("./matrixService", () => ({
  sendTranscriptSegment: mocks.segment,
  sendTranscriptSession: vi.fn().mockResolvedValue(undefined),
}));

import { armTranscription, disarmTranscription, handleSessionEvent, isTranscribing } from "./transcriptionService";
import { useTranscriptStore } from "../stores/useTranscriptStore";
import { reserveTranscriptionEngine } from "./transcriptionEngine";

const ROOM = "!voice:hs";
class Socket {
  static instances: Socket[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
}

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.stubGlobal("WebSocket", Socket);
  Socket.instances = [];
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string) => command === "detect_asr_model" ? "/model.gguf" : 42);
  mocks.segment.mockClear();
  mocks.app.connectedVoiceChannel = ROOM;
  useTranscriptStore.setState({ state: "off", sessions: {}, history: {} });
  handleSessionEvent(ROOM, "start", "session-a", Date.now(), "@alice:hs");
});
afterEach(async () => {
  disarmTranscription(ROOM);
  await reserveTranscriptionEngine().stop();
  await vi.waitFor(() => expect(isTranscribing()).toBe(false));
  vi.unstubAllGlobals();
});

describe("arrêt de la transcription pendant sa préparation", () => {
  it("un désarmement pendant la détection du modèle empêche le démarrage", async () => {
    let resolve!: (path: string) => void;
    mocks.invoke.mockImplementation((command) => command === "detect_asr_model"
      ? new Promise<string>((done) => { resolve = done; }) : Promise.resolve(42));
    const starting = armTranscription(ROOM);
    expect(isTranscribing()).toBe(true);
    disarmTranscription(ROOM);
    resolve("/model.gguf");
    await starting;
    expect(useTranscriptStore.getState().state).toBe("off");
    expect(mocks.invoke).not.toHaveBeenCalledWith("transcribe_start_native", expect.anything());
    expect(Socket.instances).toHaveLength(0);
  });

  it("quitter le vocal pendant l'invoke ferme le moteur créé tardivement", async () => {
    let resolve!: (port: number) => void;
    mocks.invoke.mockImplementation((command) => command === "transcribe_start_native"
      ? new Promise<number>((done) => { resolve = done; }) : Promise.resolve("/model.gguf"));
    const starting = armTranscription(ROOM);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const prev = { ...mocks.app };
    mocks.app.connectedVoiceChannel = "";
    for (const listener of mocks.listeners) listener(mocks.app, prev);
    resolve(42);
    await starting;
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("transcribe_stop"));
    expect(Socket.instances).toHaveLength(0);
    expect(isTranscribing()).toBe(false);
  });

  it("une fin de session pendant le téléchargement reste arrêtée", async () => {
    let reject!: (err: Error) => void;
    mocks.invoke.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const starting = armTranscription(ROOM);
    handleSessionEvent(ROOM, "end", "session-a", Date.now(), "@alice:hs");
    reject(new Error("download failed"));
    await starting;
    expect(isTranscribing()).toBe(false);
    expect(useTranscriptStore.getState().state).toBe("off");
  });

  it("ignore les messages déjà en attente d'une session arrêtée", async () => {
    await armTranscription(ROOM);
    const socket = Socket.instances[0];
    const message = socket.onmessage!;
    disarmTranscription(ROOM);
    message({ data: JSON.stringify({ type: "ready" }) });
    message({ data: JSON.stringify({ type: "segment", text: "ancienne phrase" }) });
    expect(useTranscriptStore.getState().state).toBe("off");
    expect(mocks.segment).not.toHaveBeenCalled();
  });

  it("une fermeture du WS libère le modèle et permet de repartir", async () => {
    await armTranscription(ROOM);
    Socket.instances[0].onclose!();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("transcribe_stop"));
    expect(isTranscribing()).toBe(false);
    await armTranscription(ROOM);
    expect(Socket.instances).toHaveLength(2);
  });

  it("la fin d'une autre réunion ne coupe pas notre moteur", async () => {
    await armTranscription(ROOM);
    handleSessionEvent("!other:hs", "start", "other", Date.now(), "@bob:hs");
    handleSessionEvent("!other:hs", "end", "other", Date.now(), "@bob:hs");
    expect(isTranscribing()).toBe(true);
    expect(Socket.instances[0].close).not.toHaveBeenCalled();
  });
});
