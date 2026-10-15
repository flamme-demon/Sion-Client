import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VoiceCue, VoiceSoundCfg } from "../stores/useSettingsStore";
const mocks = vi.hoisted(() => ({ play: vi.fn(), read: vi.fn(), decode: vi.fn(), bundled: vi.fn(), stop: vi.fn(), encode: vi.fn() }));
let appState: { isDeafened: boolean; connectedVoiceChannel: string | null };
let settingsState: { voiceChannelSounds: boolean; voiceSounds: Partial<Record<VoiceCue, VoiceSoundCfg>>; muteSoundsWhenDeafened: boolean };
vi.mock("./audioContext", () => ({ getSharedAudioContext: () => ({ decodeAudioData: mocks.decode }) }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: { getState: () => settingsState } }));
vi.mock("../stores/useAppStore", () => ({ useAppStore: { getState: () => appState } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.read(...args) }));
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn(async () => undefined) }));
vi.mock("./soundboardService", () => ({ decodeNativeSoundboardPcm: (...args: unknown[]) => mocks.bundled(...args) }));
vi.mock("./nativeAudioPlayback", () => ({ playNativePcm: mocks.play, tonePcm: () => "AAABAA==" }));
vi.mock("./voiceNativeService", () => ({ bytesToB64: mocks.encode }));
import {
  previewCue, resetVoiceCues, onParticipantJoined, onParticipantLeft, remplacerLecturePourTests,
  noteConnectionLost, noteRaisonDepart, primeActionCues, playMuteCue, playUnmuteCue, playJoinCue,
} from "./voiceChannelSounds";
beforeEach(() => {
  appState = { isDeafened: false, connectedVoiceChannel: null };
  settingsState = { voiceChannelSounds: true, voiceSounds: {}, muteSoundsWhenDeafened: false };
  vi.clearAllMocks();
  mocks.encode.mockImplementation((bytes: Uint8Array) => {
    let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
  });
  mocks.play.mockReturnValue({ ready: Promise.resolve(), stop: mocks.stop });
  mocks.read.mockResolvedValue(btoa("custom mp3"));
  mocks.bundled.mockResolvedValue({ pcmB64: "AAAA", durationMs: 1 });
  mocks.decode.mockResolvedValue({ duration: 1, length: 4, sampleRate: 4, numberOfChannels: 1,
    getChannelData: () => Float32Array.from([0, 0.25, 0.5, 0.75]) });
  vi.stubGlobal("Audio", vi.fn());
  resetVoiceCues();
});
afterEach(() => vi.unstubAllGlobals());
function custom(cue: VoiceCue): VoiceSoundCfg {
  const cfg = { path: `/cues/${expect.getState().currentTestName}.mp3`, start: 0.25, end: 0.75, gain: 1.8 };
  settingsState.voiceSounds[cue] = cfg;
  return cfg;
}
describe("cues exclusivement natifs", () => {
  it("joue le fichier embarqué par Rust même hors appel", async () => {
    previewCue("join");
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
    expect(mocks.bundled).toHaveBeenCalledWith(expect.stringMatching(/join[\w-]*\.mp3$/));
    expect(mocks.play).toHaveBeenCalledWith("AAAA", expect.objectContaining({ gain: 0.7 }));
    expect(Audio).not.toHaveBeenCalled();
  });
  it("un fichier injouable utilise un timbre PCM natif", async () => {
    mocks.bundled.mockRejectedValueOnce(new Error("decode"));
    previewCue("poke");
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
    expect(mocks.play).toHaveBeenCalledWith("AAABAA==", expect.objectContaining({ gain: 1 }));
    expect(Audio).not.toHaveBeenCalled();
  });
  it("Narkow : l'arrivée personnalisée garde l'extrait et le gain", async () => {
    appState.connectedVoiceChannel = "!vocal:hs";
    const cfg = custom("join");
    onParticipantJoined("@narkow:hs:PC");
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
    expect(mocks.read).toHaveBeenCalledWith("read_file_b64", { path: cfg.path });
    const [pcm, options] = mocks.play.mock.calls[0];
    expect(atob(pcm)).toHaveLength(24_000 * 2);
    expect(atob(pcm).charCodeAt(1)).toBe(32);
    expect(options.gain).toBe(1.8);
  });
  it("précharge l'arrivée personnalisée et régénère seulement le PCM si l'extrait change", async () => {
    const cfg = custom("join");
    await primeActionCues();
    expect(mocks.play).not.toHaveBeenCalled();
    playJoinCue();
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledTimes(1));
    settingsState.voiceSounds.join = { ...cfg, start: 0.5, gain: 0.4 };
    playJoinCue();
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledTimes(2));
    expect(atob(mocks.play.mock.calls[1][0])).toHaveLength(12_000 * 2);
    expect(mocks.play.mock.calls[1][1].gain).toBe(0.4);
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledOnce();
  });
  it("garde le retour de micro audible en sourdine", async () => {
    appState.isDeafened = true;
    settingsState.muteSoundsWhenDeafened = true;
    custom("mute");
    playMuteCue();
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
    expect(mocks.play.mock.calls[0][1].allowDeafened).toBe(true);
  });
  it("ne conserve pas les anciens extraits après des réglages successifs", async () => {
    const cfg = custom("join");
    await primeActionCues();
    for (const start of [0.5, 0.1, 0.4, cfg.start]) {
      settingsState.voiceSounds.join = { ...cfg, start };
      await primeActionCues();
    }
    expect(mocks.encode).toHaveBeenCalledTimes(5);
    expect(mocks.decode).toHaveBeenCalledOnce();
  });
  it("libère les fichiers retirés, même si leur décodage finit plus tard", async () => {
    let resolve!: (buffer: unknown) => void;
    const decoded = await mocks.decode();
    mocks.decode.mockClear();
    mocks.decode.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const cfg = custom("join");
    const pending = primeActionCues();
    await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
    settingsState.voiceSounds = {};
    await primeActionCues();
    resolve(decoded);
    await pending;
    settingsState.voiceSounds.join = cfg;
    await primeActionCues();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(mocks.encode).toHaveBeenCalledTimes(2);
  });
  it("garde les arrivées choisies audibles en sourdine via Rust", async () => {
    appState.isDeafened = true;
    custom("join");
    playJoinCue();
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
    expect(mocks.play.mock.calls[0][1].allowDeafened).toBe(true);
    expect(Audio).not.toHaveBeenCalled();
  });
  it("respecte la coupure des sons en sourdine", async () => {
    appState.isDeafened = true;
    settingsState.muteSoundsWhenDeafened = true;
    custom("join");
    playJoinCue();
    await Promise.resolve();
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("un retour d'action plus récent annule un décodage encore en attente", async () => {
    let resolve!: (bytes: string) => void;
    mocks.read.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    custom("mute");
    playMuteCue();
    await Promise.resolve();
    playUnmuteCue();
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
    resolve(btoa("mp3"));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.play).toHaveBeenCalledOnce();
  });
  it("le retour de kick reste audible après la fermeture de la session vocale", async () => {
    let resolve!: (bytes: string) => void;
    mocks.read.mockReturnValueOnce(new Promise<string>((done) => { resolve = done; }));
    custom("kick");
    previewCue("kick");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
    resetVoiceCues();
    resolve(btoa("kick mp3"));
    await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
  });
});

describe("arrivées encore en attente de décodage", () => {
  let resolve: (bytes: string) => void;
  beforeEach(() => {
    vi.useFakeTimers();
    appState.connectedVoiceChannel = "!vocal:hs";
    mocks.read.mockReturnValueOnce(new Promise<string>((done) => { resolve = done; }));
    custom("join");
  });
  afterEach(() => { resetVoiceCues(); vi.useRealTimers(); });
  async function finishDecode() {
    resolve(btoa("custom mp3"));
    await vi.advanceTimersByTimeAsync(0);
  }
  it("une ancienne arrivée ne se met pas à jouer au réveil du contexte", async () => {
    onParticipantJoined("@narkow:hs:PC");
    await vi.advanceTimersByTimeAsync(2500);
    await finishDecode();
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it("le départ du pair invalide le son d'arrivée qui attend encore", async () => {
    onParticipantJoined("@narkow:hs:PC");
    await vi.advanceTimersByTimeAsync(0);
    onParticipantLeft("@narkow:hs:PC");
    await finishDecode();
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it("quitter puis revenir dans le même salon invalide les sons de l'ancien appel", async () => {
    onParticipantJoined("@narkow:hs:PC");
    await vi.advanceTimersByTimeAsync(0);
    resetVoiceCues();
    await finishDecode();
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it("changer de salon invalide le son même si le nettoyage n'a pas fini", async () => {
    onParticipantJoined("@narkow:hs:PC");
    await vi.advanceTimersByTimeAsync(0);
    appState.connectedVoiceChannel = "!autre:hs";
    await finishDecode();
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it("le réglage des sons est relu après le décodage", async () => {
    onParticipantJoined("@narkow:hs:PC");
    await vi.advanceTimersByTimeAsync(0);
    settingsState.voiceChannelSounds = false;
    await finishDecode();
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it("une arrivée rapide conserve sa lecture musicale complète", async () => {
    onParticipantJoined("@narkow:hs:PC");
    await vi.advanceTimersByTimeAsync(0);
    await finishDecode();
    expect(mocks.play).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    mocks.play.mock.calls[0][1].onTime(3);
    expect(mocks.stop).not.toHaveBeenCalled();
    onParticipantLeft("@narkow:hs:PC");
    mocks.play.mock.calls[0][1].onTime(3.1);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});

describe("sons d'arrivée et de départ d'un pair", () => {
  const joues: string[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    joues.length = 0;
    remplacerLecturePourTests((cue) => joues.push(cue));
  });
  afterEach(() => {
    remplacerLecturePourTests(null);
    vi.useRealTimers();
  });

  it("téléphone de flamme, 01/10 : reconnexion, vrai départ 2 s après, retour 20 s plus tard", () => {
    const tel = "@flamme:hs:TEL";
    onParticipantJoined(tel); // 13:25:17
    expect(joues).toEqual(["join"]);
    vi.advanceTimersByTime(12_000);
    onParticipantLeft(tel); // 13:25:29 reconnexion : parti…
    onParticipantJoined(tel); // …et revenu dans la seconde : rien
    vi.advanceTimersByTime(2_000);
    onParticipantLeft(tel); // 13:25:31 : vrai départ
    vi.advanceTimersByTime(2_000);
    expect(joues).toEqual(["join", "leave"]);
    vi.advanceTimersByTime(18_000);
    onParticipantJoined(tel); // 13:25:51 : vrai retour
    expect(joues).toEqual(["join", "leave", "join"]);
  });

  it("la raison du serveur prime sur la qualité : raccrocher sonne « départ »", () => {
    // Téléphone de flamme, 01/10 : qualité passée à « perdue » au retrait de
    // sa piste, puis départ volontaire (ClientInitiated).
    const tel = "@flamme:hs:TEL";
    noteConnectionLost(tel, true);
    noteRaisonDepart(tel, false);
    onParticipantLeft(tel);
    // Vraie perte (ConnectionTimeout), même sans qualité « perdue » vue avant.
    noteRaisonDepart("@b:hs:X", true);
    onParticipantLeft("@b:hs:X");
    // Raison qui ne tranche pas : la qualité reste le repli.
    noteConnectionLost("@c:hs:Y", true);
    noteRaisonDepart("@c:hs:Y", null);
    onParticipantLeft("@c:hs:Y");
    vi.advanceTimersByTime(2_000);
    expect(joues).toEqual(["leave", "timeout", "timeout"]);
  });

  it("filtre toujours un départ annoncé deux fois, et un retour annoncé deux fois", () => {
    const pair = "@narkow:hs:PC";
    onParticipantLeft(pair);
    onParticipantLeft(pair); // même départ, annoncé en double
    vi.advanceTimersByTime(2_000);
    expect(joues).toEqual(["leave"]);
    onParticipantLeft("@b:hs:X");
    vi.advanceTimersByTime(500);
    onParticipantJoined("@b:hs:X"); // clignotement : silence
    onParticipantJoined("@b:hs:X"); // même retour, annoncé en double : silence
    vi.advanceTimersByTime(2_000);
    expect(joues).toEqual(["leave"]);
  });
});
