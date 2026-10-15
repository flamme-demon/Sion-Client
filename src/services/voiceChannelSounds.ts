// Room cues and action feedback use cached decoding and native output
// both in and outside calls. No fallback plays through the webview.
import { useSettingsStore, type VoiceSoundCfg } from "../stores/useSettingsStore";
import { useAppStore } from "../stores/useAppStore";
import { getSharedAudioContext } from "./audioContext";
import { audioBufferToNativePcm } from "./nativeAudioPcm";
import { playNativePcm, tonePcm, type NativePlayback } from "./nativeAudioPlayback";

type Cue = "join" | "leave" | "timeout" | "poke" | "kick" | "memberKicked" | "mute" | "unmute" | "deafen" | "undeafen";
const CUES: Cue[] = ["mute", "unmute", "deafen", "undeafen", "join", "leave", "timeout", "poke", "kick", "memberKicked"];
const soundFiles = import.meta.glob("../assets/sounds/*.{ogg,mp3,wav,m4a}", {
  eager: true, query: "?url", import: "default",
}) as Record<string, string>;
function fileFor(name: string): string | null {
  for (const [path, url] of Object.entries(soundFiles)) {
    if (path.split("/").pop()?.replace(/\.[^.]+$/, "") === name) return url;
  }
  return null;
}
const FILE_VOLUME = 0.7;
const SYNTH_PEAK = 0.16;
const GATED = new Set<Cue>(["join", "leave", "timeout"]);
const ACTION_FEEDBACK = new Set<Cue>(["mute", "unmute", "deafen", "undeafen"]);
function overrideFor(cue: Cue): VoiceSoundCfg | null {
  const cfg = useSettingsStore.getState().voiceSounds[cue];
  return cfg?.path ? cfg : null;
}
const bufferCache = new Map<string, Promise<AudioBuffer | null>>();
function bufferForPath(path: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(path);
  if (cached) return cached;
  const loading: Promise<AudioBuffer | null> = (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const b64 = await invoke<string>("read_file_b64", { path });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return await getSharedAudioContext().decodeAudioData(bytes.buffer);
  })().catch(() => {
    if (bufferCache.get(path) === loading) bufferCache.delete(path);
    return null;
  });
  bufferCache.set(path, loading);
  return loading;
}
const customPcmCache = new Map<string, { start: number; end: number; pcm: string }>();
function pruneCustomCueCaches() {
  const paths = new Set(CUES.map((cue) => overrideFor(cue)?.path).filter((path) => path != null));
  for (const path of bufferCache.keys()) if (!paths.has(path)) bufferCache.delete(path);
  for (const path of customPcmCache.keys()) if (!paths.has(path)) customPcmCache.delete(path);
}
async function customPcmFor(cfg: VoiceSoundCfg): Promise<string | null> {
  pruneCustomCueCaches();
  const cached = customPcmCache.get(cfg.path);
  if (cached?.start === cfg.start && cached.end === cfg.end) return cached.pcm;
  const loading = bufferForPath(cfg.path);
  const buffer = await loading;
  if (!buffer) return null;
  const start = Math.max(0, Math.min(cfg.start, buffer.duration));
  const end = cfg.end > start ? Math.min(cfg.end, buffer.duration) : buffer.duration;
  const { bytesToB64 } = await import("./voiceNativeService");
  const pcm = bytesToB64(audioBufferToNativePcm(buffer, start, end));
  // Keep one trim per configured file. A removed in-flight decode cannot
  // repopulate the cache after a later settings change.
  if (bufferCache.get(cfg.path) === loading && CUES.some((cue) => {
    const current = overrideFor(cue);
    return current?.path === cfg.path && current.start === cfg.start && current.end === cfg.end;
  })) customPcmCache.set(cfg.path, { start: cfg.start, end: cfg.end, pcm });
  return pcm;
}
const nativePcmCache = new Map<Cue, Promise<string | null>>();
function nativePcmFor(cue: Cue): Promise<string | null> {
  const cached = nativePcmCache.get(cue);
  if (cached) return cached;
  const loading = (async () => {
    const url = fileFor(cue);
    if (!url) return null;
    try {
      const { decodeNativeSoundboardPcm } = await import("./soundboardService");
      return (await decodeNativeSoundboardPcm(url)).pcmB64;
    } catch {
      nativePcmCache.delete(cue);
      return null;
    }
  })();
  nativePcmCache.set(cue, loading);
  return loading;
}
async function logCue(message: string) {
  try { const { info } = await import("@tauri-apps/plugin-log"); await info(`[cue] ${message}`); } catch { /* outside Tauri */ }
}
let actionGeneration = 0;
const actions = new Set<NativePlayback>();
let cueGeneration = 0;
let nextCueId = 0;
const participantVersions = new Map<string, number>();
const automaticCues = new Set<NativePlayback>();
const CUE_MAX_DELAY_MS = 2000;
interface ParticipantCue { identity: string; version: number }
interface CueRequest {
  id: number;
  generation: number;
  actionGeneration: number;
  requestedAt: number;
  room: string | null;
  participant?: ParticipantCue;
}
function currentRequest(cue: Cue, request: CueRequest, checkAge: boolean): boolean {
  if (request.participant && request.generation !== cueGeneration) return false;
  const settings = useSettingsStore.getState();
  const app = useAppStore.getState();
  if (GATED.has(cue) && !settings.voiceChannelSounds) return false;
  if (ACTION_FEEDBACK.has(cue)) return request.actionGeneration === actionGeneration;
  if (settings.muteSoundsWhenDeafened && app.isDeafened) return false;
  if (request.participant) {
    if (!request.room || request.room !== app.connectedVoiceChannel) return false;
    if (participantVersions.get(request.participant.identity) !== request.participant.version) return false;
    if (checkAge && Date.now() - request.requestedAt > CUE_MAX_DELAY_MS) return false;
  }
  return true;
}
function startPlayback(cue: Cue, pcm: string, gain: number, request: CueRequest) {
  const action = ACTION_FEEDBACK.has(cue);
  if (!currentRequest(cue, request, true)) {
    void logCue(`${cue} #${request.id}: demande périmée ou annulée`);
    return;
  }
  let started = false;
  const player = playNativePcm(pcm, {
    gain,
    allowDeafened: action || !useSettingsStore.getState().muteSoundsWhenDeafened,
    onTime: (seconds) => {
      if (!currentRequest(cue, request, false)) { player.stop(); return; }
      if (!started && seconds > 0) {
        started = true;
        void logCue(`${cue} #${request.id}: lecture native confirmée, position ${Math.round(seconds * 1000)} ms, demande il y a ${Date.now() - request.requestedAt} ms`);
      }
    },
    onEnd: () => { actions.delete(player); automaticCues.delete(player); },
  });
  if (request.participant) automaticCues.add(player);
  if (action) actions.add(player);
  void player.ready.then(() => {
    if (!currentRequest(cue, request, true)) { player.stop(); return; }
    return logCue(`${cue} #${request.id}: natif prêt`);
  }).catch(() => logCue(`${cue} #${request.id}: lecture native refusée`));
}
async function playDefault(cue: Cue, request: CueRequest) {
  const pcm = await nativePcmFor(cue);
  startPlayback(cue, pcm || SYNTH[cue](), pcm ? FILE_VOLUME : 1, request);
}
function play(cue: Cue, participant?: ParticipantCue) {
  pruneCustomCueCaches();
  const settings = useSettingsStore.getState();
  if (GATED.has(cue) && !settings.voiceChannelSounds) return;
  const action = ACTION_FEEDBACK.has(cue);
  if (!action && settings.muteSoundsWhenDeafened && useAppStore.getState().isDeafened) return;
  if (action) {
    actionGeneration++;
    for (const player of [...actions]) player.stop();
  }
  const request: CueRequest = {
    id: ++nextCueId, generation: cueGeneration, actionGeneration,
    requestedAt: Date.now(), room: useAppStore.getState().connectedVoiceChannel,
    participant,
  };
  void logCue(`${cue} #${request.id}: demandé${participant ? ` pour ${participant.identity} dans ${request.room}` : " manuellement"}`);
  const custom = overrideFor(cue);
  if (custom) {
    void customPcmFor(custom).then((pcm) => {
      if (pcm) startPlayback(cue, pcm, Math.max(0, custom.gain), request);
      else void playDefault(cue, request);
    });
  } else void playDefault(cue, request);
}

const SYNTH: Record<Cue, () => string> = {
  join: () => tonePcm(
    [{ freq: 659.25, start: 0, dur: 0.1 }, { freq: 987.77, start: 0.09, dur: 0.13 }], "sine", SYNTH_PEAK),
  leave: () => tonePcm(
    [{ freq: 987.77, start: 0, dur: 0.1 }, { freq: 659.25, start: 0.09, dur: 0.13 }], "sine", SYNTH_PEAK),
  timeout: () => tonePcm(
    [{ freq: 440, start: 0, dur: 0.09 }, { freq: 349.23, start: 0.1, dur: 0.09 }, { freq: 261.63, start: 0.2, dur: 0.16 }],
    "triangle", SYNTH_PEAK),
  // Attention fanfare (matches the old soundService.playPoke character).
  poke: () => tonePcm(
    [{ freq: 523.25, start: 0, dur: 0.1 }, { freq: 659.25, start: 0.09, dur: 0.1 }, { freq: 783.99, start: 0.18, dur: 0.22 }],
    "sawtooth", 0.12),
  // You got kicked — harsh descending buzz.
  kick: () => tonePcm(
    [{ freq: 392, start: 0, dur: 0.12 }, { freq: 311.13, start: 0.11, dur: 0.12 }, { freq: 196, start: 0.22, dur: 0.22 }],
    "sawtooth", 0.18),
  // Someone in your channel got kicked — short neutral two-tone (witnesses).
  memberKicked: () => tonePcm(
    [{ freq: 466.16, start: 0, dur: 0.09 }, { freq: 349.23, start: 0.1, dur: 0.14 }], "triangle", SYNTH_PEAK),
  // Local action feedback — descending = off, ascending = on (ported from the
  // old soundService dual-tones).
  mute: () => tonePcm(
    [{ freq: 480, start: 0, dur: 0.1 }, { freq: 320, start: 0.06, dur: 0.1 }], "sine", SYNTH_PEAK),
  unmute: () => tonePcm(
    [{ freq: 320, start: 0, dur: 0.1 }, { freq: 480, start: 0.06, dur: 0.1 }], "sine", SYNTH_PEAK),
  deafen: () => tonePcm(
    [{ freq: 400, start: 0, dur: 0.12 }, { freq: 250, start: 0.08, dur: 0.12 }], "sine", SYNTH_PEAK),
  undeafen: () => tonePcm(
    [{ freq: 250, start: 0, dur: 0.12 }, { freq: 400, start: 0.08, dur: 0.12 }], "sine", SYNTH_PEAK),
};

/** Peers whose connection was reported `lost` → treat their next disconnect
 *  as a timeout rather than a clean leave. Keyed by identity. */
const lostPeers = new Set<string>();

export function noteConnectionLost(identity: string, lost: boolean) {
  if (lost) lostPeers.add(identity);
  else lostPeers.delete(identity);
}

/** Raison d'un départ donnée par le serveur (moteur natif), qui prime sur la
 *  dernière qualité de connexion connue : le retrait de la piste d'un pair
 *  qui raccroche fait passer sa qualité à « perdue » juste avant son départ,
 *  et sonnait « connexion perdue » (téléphone de flamme, 01/10). `null` :
 *  la raison ne tranche pas, la qualité reste le repli. Consommée par le
 *  départ qui suit. */
const raisonsDepart = new Map<string, boolean>();
export function noteRaisonDepart(identity: string, perdu: boolean | null) {
  if (perdu == null) raisonsDepart.delete(identity);
  else raisonsDepart.set(identity, perdu);
}

// LiveKit can fire ParticipantDisconnected twice for the same peer (most often
// after a watchdog-triggered `simulateScenario('full-reconnect')` re-emits the
// disconnect for a peer that's already gone). The first call consumes the
// `lost` flag and plays `timeout`; the second, with the flag cleared, played
// `leave` on top — hence the reported "timeout + leave" double. Dedup by
// identity within a short window so only the first cue plays.
const LEAVE_DEDUP_MS = 2500;
const recentLeaves = new Map<string, number>();

// Matrix user IDs we just saw kicked from our voice channel. Their imminent
// LiveKit disconnect must NOT also play a leave/timeout cue — the kick cue
// (kick / memberKicked) already covered the departure.
const KICK_SUPPRESS_MS = 5000;
const recentlyKicked = new Map<string, number>();

/** Record that `mxid` was just voice-kicked, so its LiveKit departure stays
 *  silent (the kick cue speaks for it). Called from the kick event handler. */
export function noteKicked(mxid: string) {
  recentlyKicked.set(mxid, Date.now());
}

// The rtc-backend identity is `@user:server` + suffix; extract the bare mxid.
function mxidOf(identity: string): string | null {
  return identity.match(/^(@[^:]+:[^:]+)/)?.[1] ?? null;
}

function wasRecentlyKicked(identity: string): boolean {
  const mxid = mxidOf(identity);
  if (!mxid) return false;
  const ts = recentlyKicked.get(mxid);
  if (ts == null) return false;
  recentlyKicked.delete(mxid);
  return Date.now() - ts < KICK_SUPPRESS_MS;
}

/** Clear tracked state — call when the local user leaves the room. */
export function resetVoiceCues() {
  cueGeneration++;
  actionGeneration++;
  for (const player of [...automaticCues, ...actions]) player.stop();
  automaticCues.clear();
  actions.clear();
  participantVersions.clear();
  lostPeers.clear();
  raisonsDepart.clear();
  recentLeaves.clear();
  recentlyKicked.clear();
  for (const timer of pendingLeaves.values()) clearTimeout(timer);
  pendingLeaves.clear();
  bouncedBack.clear();
}

/** Preload every cue, including custom files. */
export async function primeActionCues(): Promise<void> {
  pruneCustomCueCaches();
  await Promise.all(CUES.map(async (cue) => {
    const custom = overrideFor(cue);
    if (custom) await customPcmFor(custom);
    else await nativePcmFor(cue);
    SYNTH[cue]();
  }));
}

export function playJoinCue() {
  play("join");
}

/** You received a poke. Always plays (customizable), independent of the
 *  join/leave cue toggle. */
export function playPokeCue() {
  play("poke");
}

/** You were voice-kicked from a channel. */
export function playKickCue() {
  play("kick");
}

/** Someone else in your current voice channel was kicked — so witnesses know. */
export function playMemberKickedCue() {
  play("memberKicked");
}

// Local action-feedback (your own mic mute / deafen toggle). Always play,
// customizable, never silenced by deafen. Replace the old soundService beeps.
export function playMuteCue() {
  play("mute");
}
export function playUnmuteCue() {
  play("unmute");
}
export function playDeafenCue() {
  play("deafen");
}
export function playUndeafenCue() {
  play("undeafen");
}

/** Play a cue on demand (Settings preview button). Respects the enabled
 *  toggle so the preview matches what you'll actually hear. */
export function previewCue(cue: Cue) {
  play(cue);
}

// ── Anti-clignotement des reconnexions ─────────────────────────────────────
// Une reconnexion d'un pair se présente comme : piste dépubliée → « parti »
// (raison UnknownReason) → « rejoint » → piste republiée, le tout dans la même
// seconde (constaté en log le 12/09). Annoncer un départ ET un retour pour ça,
// c'est sonoriser un événement qui n'a pas eu lieu. Le départ est donc RETARDÉ
// de `LEAVE_GRACE_MS` : si le pair revient pendant la fenêtre, les deux cues
// sont annulés — il n'a jamais semblé absent.
const LEAVE_GRACE_MS = 1800;
const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();
/** Pairs revenus pendant leur fenêtre de grâce, et quand. Une annonce de
 *  retour en double, juste après, ne sonne pas ; passé `BOUNCE_DUP_MS`, la
 *  marque est périmée. Sans limite, elle taisait la VRAIE arrivée suivante,
 *  même des minutes plus tard (téléphone de flamme, 01/10). */
const bouncedBack = new Map<string, number>();
const BOUNCE_DUP_MS = 3000;

/** Lecture d'un son ; remplaçable par les tests (décisions sans audio). */
let jouer: (cue: Cue, participant?: ParticipantCue) => void = play;
export function remplacerLecturePourTests(f: ((cue: Cue) => void) | null): void {
  jouer = f ?? play;
}

/** Un pair vient d'apparaître dans la liste des participants. */
export function onParticipantJoined(identity: string) {
  const version = (participantVersions.get(identity) ?? 0) + 1;
  participantVersions.set(identity, version);
  const now = Date.now();
  // Revenu : son prochain départ est un nouveau départ, pas le doublon du
  // précédent. Sans cela, un vrai départ moins de 2,5 s après une
  // reconnexion était avalé.
  recentLeaves.delete(identity);
  const pending = pendingLeaves.get(identity);
  if (pending != null) {
    // Clignotement : on annule le départ en attente ET on tait le retour.
    clearTimeout(pending);
    pendingLeaves.delete(identity);
    bouncedBack.set(identity, now);
    return;
  }
  // Une annonce de retour en double, juste après un clignotement, ne sonne
  // pas ; une marque plus ancienne ne compte plus.
  const rebond = bouncedBack.get(identity);
  bouncedBack.delete(identity);
  if (rebond != null && now - rebond < BOUNCE_DUP_MS) return;
  jouer("join", { identity, version });
}

export function onParticipantLeft(identity: string) {
  const now = Date.now();
  const prev = recentLeaves.get(identity);
  if (prev != null && now - prev < LEAVE_DEDUP_MS) {
    // Duplicate ParticipantDisconnected — first call already scheduled the cue.
    lostPeers.delete(identity);
    return;
  }
  if (pendingLeaves.has(identity)) return;
  const version = (participantVersions.get(identity) ?? 0) + 1;
  participantVersions.set(identity, version);
  recentLeaves.set(identity, now);
  const parQualite = lostPeers.delete(identity);
  const raison = raisonsDepart.get(identity);
  raisonsDepart.delete(identity);
  const timedOut = raison ?? parQualite;
  // A kicked peer's departure is already announced by the kick cue.
  if (wasRecentlyKicked(identity)) return;
  const timer = setTimeout(() => {
    pendingLeaves.delete(identity);
    jouer(timedOut ? "timeout" : "leave", { identity, version });
  }, LEAVE_GRACE_MS);
  pendingLeaves.set(identity, timer);
}
