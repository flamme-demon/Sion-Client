import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/useSettingsStore";
import { audioBufferToNativePcm } from "./nativeAudioPcm";
import { bytesToB64, getVoiceNativeAudioDevices } from "./voiceNativeService";

export interface NativePlayback {
  ready: Promise<void>;
  stop: () => void;
  setGain: (gain: number) => void;
}
export interface PlaybackOptions {
  gain?: number;
  allowDeafened?: boolean;
  onTime?: (seconds: number) => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
}
interface Status { positionMs: number; bufferedMs: number; done: boolean; error: string | null }
const active = new Set<NativePlayback>();
let outputKey: string | null = null;
let outputName: Promise<string | undefined> | null = null;
function selectedOutput(): Promise<string | undefined> {
  const id = useSettingsStore.getState().nativeAudioOutputDevice;
  if (!id) return Promise.resolve(undefined);
  if (id !== outputKey || !outputName) {
    outputKey = id;
    outputName = getVoiceNativeAudioDevices().then((devices) => devices.playout.find((d) => d.id === id)?.name).catch(() => undefined);
  }
  return outputName;
}

/** Buffer at most two seconds in Rust, with one IPC call in flight.
 *  Stopping during open/push also releases players created after cancellation. */
function playStream(
  duration: number,
  channels: 1 | 2,
  chunk: (start: number, end: number) => Uint8Array,
  options: PlaybackOptions,
  shortClip?: string,
): NativePlayback {
  let id: number | null = null;
  let sent = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  let gain = options.gain ?? 1;
  const finish = () => {
    if (ended) return;
    ended = true;
    active.delete(player);
    options.onEnd?.();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (id !== null) void invoke("audio_native_stop", { id }).catch(console.warn);
    finish();
  };
  const nextChunk = () => {
    const end = Math.min(duration, sent + 1);
    const pcmB64 = bytesToB64(chunk(sent, end));
    sent = end;
    return { pcmB64, channels, finished: sent >= duration };
  };
  const poll = async () => {
    if (stopped || id === null) return;
    try {
      const status = await invoke<Status>("audio_native_status", { id });
      if (stopped) return;
      if (status.error) throw new Error(status.error);
      options.onTime?.(Math.min(duration, status.positionMs / 1000));
      if (status.done) { stopped = true; finish(); return; }
      if (status.bufferedMs < 1000 && sent < duration) {
        await invoke("audio_native_push", { id, ...nextChunk() });
      }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 80);
    } catch (error) {
      if (!stopped) { options.onError?.(error); console.warn("[Sion][audio] lecture native", error); stop(); }
    }
  };
  const ready = (async () => {
    const outputDevice = await selectedOutput();
    if (stopped) return;
    const initial = shortClip !== undefined ? { pcmB64: shortClip, channels, finished: true } : nextChunk();
    if (shortClip !== undefined) sent = duration;
    id = await invoke<number>("audio_native_open", {
      ...initial, gain,
      allowDeafened: options.allowDeafened ?? false, outputDevice,
    });
    if (stopped) { await invoke("audio_native_stop", { id }); return; }
    timer = setTimeout(() => { void poll(); }, 20);
  })();
  const setGain = (next: number) => {
    gain = next;
    void ready.then(async () => {
      if (!stopped && id !== null) await invoke("audio_native_volume", { id, gain });
    }).catch(console.warn);
  };
  const player = { ready, stop, setGain };
  active.add(player);
  void ready.catch((error) => {
    if (!stopped) { options.onError?.(error); console.warn("[Sion][audio] démarrage natif", error); stop(); }
  });
  return player;
}

/** Already-decoded 48 kHz mono PCM for cues and alerts. */
export function playNativePcm(pcmB64: string, options: PlaybackOptions = {}): NativePlayback {
  const binary = atob(pcmB64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const duration = bytes.length / 96_000;
  return playStream(duration, 1, (a, b) => bytes.subarray(Math.round(a * 48_000) * 2, Math.round(b * 48_000) * 2), options, duration <= 20 ? pcmB64 : undefined);
}

/** Stereo previews with unrestricted duration and native position/stop.
 *  The browser only decodes the file and draws its waveform. */
export function playNativeBuffer(buffer: AudioBuffer, start: number, end: number, options: PlaybackOptions = {}): NativePlayback {
  const from = Math.max(0, Math.min(start, buffer.duration));
  const to = Math.max(from, Math.min(end, buffer.duration));
  const channels = buffer.numberOfChannels > 1 ? 2 : 1;
  return playStream(to - from, channels, (a, b) => audioBufferToNativePcm(buffer, from + a, from + b, channels), {
    ...options,
    onTime: (seconds) => options.onTime?.(from + seconds),
  });
}

export function stopAllNativePlayback(): void { for (const player of [...active]) player.stop(); }
if (typeof window !== "undefined") window.addEventListener("pagehide", stopAllNativePlayback);

export interface ToneNote { freq: number; start: number; dur: number; endFreq?: number }
const toneCache = new Map<string, string>();
/** Offline synthesis without connecting to Web Audio output. */
export function tonePcm(notes: ToneNote[], wave: OscillatorType = "sine", peak = 0.16): string {
  const key = JSON.stringify([notes, wave, peak]);
  const cached = toneCache.get(key);
  if (cached) return cached;
  const duration = Math.max(...notes.map((n) => n.start + n.dur)) + 0.03;
  const pcm = new Int16Array(Math.ceil(duration * 48_000));
  for (let i = 0; i < pcm.length; i++) {
    const time = i / 48_000;
    let sample = 0;
    for (const note of notes) {
      const t = time - note.start;
      if (t < 0 || t >= note.dur) continue;
      const ratio = note.endFreq ? note.endFreq / note.freq : 1;
      const cycles = ratio === 1 ? note.freq * t : note.freq * note.dur * (Math.pow(ratio, t / note.dur) - 1) / Math.log(ratio);
      const phase = cycles % 1;
      const value = wave === "sawtooth" ? phase * 2 - 1 : wave === "triangle" ? 1 - 4 * Math.abs(phase - 0.5) : wave === "square" ? (phase < 0.5 ? 1 : -1) : Math.sin(cycles * Math.PI * 2);
      const envelope = t < 0.012 ? t / 0.012 : Math.pow(0.0001 / Math.max(peak, 0.0001), (t - 0.012) / Math.max(0.001, note.dur - 0.012));
      sample += value * peak * envelope;
    }
    pcm[i] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
  }
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  pcm.forEach((sample, i) => view.setInt16(i * 2, sample, true));
  const encoded = bytesToB64(bytes);
  toneCache.set(key, encoded);
  return encoded;
}

export function playNativeTone(notes: ToneNote[], wave: OscillatorType = "sine", peak = 0.16, allowDeafened = false): NativePlayback {
  return playNativePcm(tonePcm(notes, wave, peak), { allowDeafened });
}
