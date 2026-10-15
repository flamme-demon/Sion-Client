import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), decode: vi.fn(), model: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./transcriptionService", () => ({ ensureModelDownloaded: mocks.model }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: {
  getState: () => ({ transcribeModel: "parakeet", transcribeLang: "fr" }),
} }));

import { transcribeRef } from "./ttsService";
import { reserveTranscriptionEngine } from "./transcriptionEngine";

class Socket {
  static instances: Socket[] = [];
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
}
const file = { arrayBuffer: async () => new ArrayBuffer(4) } as File;

beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(42);
  mocks.decode.mockReset();
  mocks.decode.mockResolvedValue({ getChannelData: () => new Float32Array(16000) });
  mocks.model.mockReset();
  mocks.model.mockResolvedValue("/model.gguf");
  vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = mocks.decode; });
  vi.stubGlobal("AudioContext", vi.fn(() => { throw new Error("no audio device allowed"); }));
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(async () => {
  await reserveTranscriptionEngine().stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("transcription d'un fichier de référence", () => {
  it("un fichier illisible ne charge pas le modèle et libère sa réservation", async () => {
    mocks.decode.mockRejectedValue(new Error("bad audio"));
    await expect(transcribeRef(file)).rejects.toThrow("bad audio");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it("réserve pendant le décodage et refuse un second fichier ou une réunion", async () => {
    let resolve!: (buffer: unknown) => void;
    mocks.decode.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const first = transcribeRef(file);
    const failure = expect(first).rejects.toThrow("websocket");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await expect(transcribeRef(file)).rejects.toThrow("busy");
    expect(() => reserveTranscriptionEngine()).toThrow("busy");
    resolve({ getChannelData: () => new Float32Array(16000) });
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    Socket.instances[0].onerror!();
    await failure;
    expect(mocks.invoke).toHaveBeenLastCalledWith("transcribe_stop");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("termine une lecture normale, ferme le WS et attend la libération Rust", async () => {
    const text = transcribeRef(file);
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const ws = Socket.instances[0];
    ws.onopen!();
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "flush" }));
    ws.onmessage!({ data: JSON.stringify({ type: "ready" }) });
    ws.onmessage!({ data: JSON.stringify({ type: "segment", text: " Bonjour  Sion " }) });
    await vi.advanceTimersByTimeAsync(2500);
    expect(await text).toBe("Bonjour Sion");
    expect(ws.close).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenLastCalledWith("transcribe_stop");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("une erreur après ready ne laisse aucun timer capable d'arrêter le moteur suivant", async () => {
    const text = transcribeRef(file);
    const failure = expect(text).rejects.toThrow("engine failed");
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const ws = Socket.instances[0];
    ws.onmessage!({ data: JSON.stringify({ type: "ready" }) });
    ws.onmessage!({ data: JSON.stringify({ type: "error", message: "engine failed" }) });
    await failure;
    const next = reserveTranscriptionEngine();
    await next.start("transcribe_start_native", {});
    mocks.invoke.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await next.stop();
  });

  it("une erreur de construction WS après le démarrage décharge quand même le modèle", async () => {
    vi.stubGlobal("WebSocket", class { constructor() { throw new Error("socket constructor"); } });
    await expect(transcribeRef(file)).rejects.toThrow("socket constructor");
    expect(mocks.invoke).toHaveBeenLastCalledWith("transcribe_stop");
  });
});
