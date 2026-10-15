import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: { getState: () => ({ nativeAudioOutputDevice: "" }) } }));
vi.mock("./voiceNativeService", () => ({
  bytesToB64: (bytes: Uint8Array) => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  },
  getVoiceNativeAudioDevices: vi.fn(),
}));
import { playNativeBuffer, playNativePcm, playNativeTone, stopAllNativePlayback } from "./nativeAudioPlayback";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string) => command === "audio_native_open" ? 42 : undefined);
});
afterEach(() => { stopAllNativePlayback(); vi.useRealTimers(); });

describe("lectures locales natives", () => {
  it("annule un open en attente et ferme le lecteur créé après l'arrêt", async () => {
    let resolve!: (id: number) => void;
    mocks.invoke.mockImplementation((command: string) => command === "audio_native_open" ? new Promise((r) => { resolve = r; }) : Promise.resolve());
    const onEnd = vi.fn();
    const player = playNativePcm(btoa("\x00\x00"), { onEnd });
    await Promise.resolve();
    player.stop();
    player.stop();
    resolve(77);
    await player.ready;
    expect(mocks.invoke).toHaveBeenCalledWith("audio_native_stop", { id: 77 });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("transmet une lecture longue stéréo par tranches bornées et suit la position Rust", async () => {
    const onTime = vi.fn();
    const onEnd = vi.fn();
    const buffer = { duration: 60, length: 60 * 48_000, sampleRate: 48_000, numberOfChannels: 2,
      getChannelData: (channel: number) => new Float32Array(60 * 48_000).fill(channel ? -0.25 : 0.5),
    } as AudioBuffer;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "audio_native_open") return 42;
      if (command === "audio_native_status") return { positionMs: 400, bufferedMs: 600, done: false, error: null };
    });
    const player = playNativeBuffer(buffer, 5, 60, { gain: 1.5, onTime, onEnd });
    await player.ready;
    const open = mocks.invoke.mock.calls.find(([command]) => command === "audio_native_open")![1];
    expect(open).toMatchObject({ channels: 2, gain: 1.5, finished: false });
    expect(atob(open.pcmB64)).toHaveLength(48_000 * 4);
    const binary = atob(open.pcmB64);
    expect(binary.charCodeAt(1)).toBe(64); // +0,5, gauche
    expect(binary.charCodeAt(3)).toBe(224); // -0,25, droite
    await vi.advanceTimersByTimeAsync(20);
    expect(onTime).toHaveBeenLastCalledWith(5.4);
    const push = mocks.invoke.mock.calls.find(([command]) => command === "audio_native_push")![1];
    expect(atob(push.pcmB64)).toHaveLength(48_000 * 4);
    player.stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "audio_native_status")).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("termine uniquement après la fin annoncée par la sortie et libère ses timers", async () => {
    const onEnd = vi.fn();
    mocks.invoke.mockImplementation(async (command: string) => command === "audio_native_open" ? 42 : { positionMs: 1, bufferedMs: 0, done: true, error: null });
    const player = playNativePcm(btoa("\x00\x00"), { onEnd });
    await player.ready;
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("synthétise une alerte dans le PCM sans créer de sortie Web Audio", async () => {
    const audio = vi.fn();
    vi.stubGlobal("AudioContext", audio);
    const player = playNativeTone([{ freq: 800, start: 0, dur: 0.08 }], "sine", 0.15);
    await player.ready;
    const open = mocks.invoke.mock.calls[0][1];
    expect(atob(open.pcmB64).length).toBeGreaterThan(48_000 * 0.08 * 2);
    expect(audio).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("change le volume pendant la lecture sans rouvrir la source", async () => {
    const player = playNativePcm(btoa("\x00\x00"));
    await player.ready;
    player.setGain(0.3);
    await Promise.resolve();
    expect(mocks.invoke).toHaveBeenCalledWith("audio_native_volume", { id: 42, gain: 0.3 });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "audio_native_open")).toHaveLength(1);
    player.stop();
    player.setGain(0.7);
    await Promise.resolve();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "audio_native_volume")).toHaveLength(1);
  });
});
