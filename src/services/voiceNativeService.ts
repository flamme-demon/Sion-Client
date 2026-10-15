/**
 * Frontend bridge to the Rust LiveKit voice engine. Exposes voice_native.rs
 * Tauri commands and events with the ParticipantInfo contract used by useLiveKitStore.
 */

import type { ConnectionQuality, ParticipantInfo } from "../types/livekit";
import type { AudioQualityPreset } from "../stores/useSettingsStore";
import { getMatrixClient, getRoomMemberInfo } from "./matrixService";
import { appareilDeIdentite } from "../utils/identiteVocale";

export type VoiceNativeState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface VoiceNativeStatus {
  android_control?: boolean;
  state: VoiceNativeState;
  room_name: string | null;
  muted: boolean;
  deafened: boolean;
  /** Actual engine microphone publication state; may differ from mute after desynchronization. */
  mic_published: boolean;
  /**
   * Actual screen-share publication state. The engine can keep sharing
   * while frontend memory resets during a webview reload.
   */
  screenshare_published: boolean;
  /** Whether the local share actually publishes audio; restore the indicator after reload. */
  screenshare_audio_published: boolean;
  camera_published?: boolean;
  identity: string | null;
}

/** Tauri event emitted on native state changes. */
export const VOICE_NATIVE_STATUS_EVENT = "voice-native-status";
/** Native participant snapshot matching ParticipantInfo. */
export const VOICE_NATIVE_PARTICIPANTS_EVENT = "voice-native-participants";
/**
 * Raw data-channel relay: topic, payload_b64 and sender, with type=data_received.
 * The frontend dispatches to soundboard, AFK and cursor handlers.
 */
export const VOICE_NATIVE_DATA_EVENT = "voice-native-data";
/** Capture failed after publication; close the overlay and request unpublishing immediately. */
export const VOICE_NATIVE_LOCAL_SHARE_FAILED_EVENT = "voice-native-local-share-failed";

/** Participant E2EE diagnostics: Ok, MissingKey, DecryptionFailed, etc. */
export interface VoiceNativeE2eeState {
  identity: string;
  state: string;
}

export interface VoiceNativeData {
  topic: string | null;
  payload_b64: string;
  sender: string | null;
}

export interface VoiceNativeLocalShareFailed {
  reason: string;
}

/**
 * Auto-join may start only while no session is connected or connecting,
 * so it cannot collide with manual join or replace an active call.
 */
export function shouldAutoJoinVoice(
  targetRoomId: string,
  connectedVoiceChannel: string | null,
  connectingVoiceChannel: string | null,
): boolean {
  if (!targetRoomId) return false;
  if (connectedVoiceChannel) return false;
  if (connectingVoiceChannel) return false;
  return true;
}

/** base64 → Uint8Array (payloads data-channel natifs). */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array → base64 (envoi data-channel natif). */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Publish session data: lossy delivery for 60 Hz cursors, reliable delivery otherwise. */
export function voiceNativePublishData(topic: string, payloadB64: string, reliable = true): Promise<void> {
  return tauriInvoke<void>("voice_native_publish_data", { topic, payloadB64, reliable });
}

/**
 * Send decoded mono 48 kHz i16 PCM once through IPC.
 * The native WebRTC render callback consumes it in 10 ms blocks.
 */
export function playVoiceNativeSoundboard(
  pcmB64: string,
  gain: number,
  /** Local action feedback plays even while deafened; deafen silences peers. */
  localFeedback = false,
): Promise<void> {
  return tauriInvoke<void>("voice_native_play_soundboard", { pcmB64, gain, localFeedback });
}

/**
 * Extend a sender's badge using measured duration when playback actually starts.
 * Packet receipt precedes downloading and decoding; emoji restores an expired badge.
 * Never shorten expiry, and call only when the sound is played locally.
 */
export function extendVoiceNativeSoundboardBadge(
  sender: string,
  durationMs: number,
  emoji?: string,
): Promise<void> {
  return tauriInvoke<void>("voice_native_extend_soundboard_badge", { sender, durationMs, emoji });
}

/**
 * Toggle a sender's screen-share audio; return true if ScreenshareAudio exists.
 * Local track volume is controlled separately.
 */
export function setVoiceNativeShareAudioMuted(sender: string, muted: boolean): Promise<boolean> {
  return tauriInvoke<boolean>("voice_native_set_screenshare_audio_muted", { sender, muted });
}

/** Read share mute and volume from the engine to restore state after webview reload. */
export function getVoiceNativeShareAudioState(sender: string): Promise<{ muted: boolean; volume: number }> {
  return tauriInvoke<{ muted: boolean; volume: number }>("voice_native_get_screenshare_audio_state", { sender });
}

export function setVoiceNativeShareAudioVolume(sender: string, volume: number): Promise<boolean> {
  return tauriInvoke<boolean>("voice_native_set_screenshare_audio_volume", { sender, volume });
}

/** Toggle native local screen sharing. withAudio=false publishes video only. */
export interface NativeScreenShareResult { audioPublished: boolean }
export function setVoiceNativeScreensharing(
  enabled: boolean,
  options: {
    sourceId?: number;
    withAudio?: boolean;
    resolution?: "720p" | "1080p" | "1440p";
    framerate?: 5 | 15 | 30 | 60;
    /**
     * Published-track codec. Resolve auto before calling through peer negotiation.
     * AV1/H264 request available hardware backends; VP9/VP8 use software.
     */
    videoCodec?: "av1" | "vp9" | "h264" | "vp8";
  } = {},
): Promise<NativeScreenShareResult> {
  return tauriInvoke<NativeScreenShareResult>("voice_native_set_screensharing", {
    enabled,
    sourceId: options.sourceId ?? null,
    withAudio: options.withAudio ?? true,
    resolution: options.resolution ?? "1080p",
    framerate: options.framerate ?? 15,
    videoCodec: options.videoCodec ?? "h264",
  });
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function isVoiceNativeAvailable(): Promise<boolean> {
  if (!(
    typeof window !== "undefined" &&
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  )) return false;
  try {
    return await tauriInvoke<boolean>("voice_native_available");
  } catch {
    return false;
  }
}

export interface NativeAudioDevice { id: string; name: string; index: number }
export interface NativeAudioDevices {
  recording: NativeAudioDevice[];
  playout: NativeAudioDevice[];
}

export function getVoiceNativeAudioDevices(): Promise<NativeAudioDevices> {
  return tauriInvoke("voice_native_audio_devices");
}

export interface NativeAudioProcessing {
  echoCancellation: boolean;
  autoGainControl: boolean;
  noiseSuppression: boolean;
  mix: number;
}

export function setVoiceNativeAudioProcessing(processing: NativeAudioProcessing): Promise<void> {
  return tauriInvoke("voice_native_set_audio_processing", { processing });
}

export function switchVoiceNativeAudioDevice(kind: "input" | "output", deviceId: string): Promise<void> {
  return tauriInvoke("voice_native_switch_audio_device", { kind, deviceId });
}

export interface NativeAudioLevel { sequence: number; rms: number }

export function startVoiceNativeMicrophoneTest(deviceId: string, owner: string): Promise<void> {
  return tauriInvoke("voice_native_start_microphone_test", { deviceId, owner });
}

export function stopVoiceNativeAudioTest(owner: string): Promise<void> {
  return tauriInvoke("voice_native_stop_audio_test", { owner });
}

export function getVoiceNativeAudioLevel(): Promise<NativeAudioLevel> {
  return tauriInvoke("voice_native_audio_level");
}

export function testVoiceNativeSpeaker(outputDevice: string): Promise<void> {
  return tauriInvoke("voice_native_test_speaker", { outputDevice });
}

export function setVoiceNativeAudioQuality(quality: AudioQualityPreset): Promise<void> {
  return tauriInvoke("voice_native_set_audio_quality", { quality });
}

export function getVoiceNativeStatus(): Promise<VoiceNativeStatus> {
  return tauriInvoke<VoiceNativeStatus>("voice_native_status");
}

export interface VoiceNativeDebug {
  state: VoiceNativeState;
  room_name: string | null;
  muted: boolean;
  deafened: boolean;
  identity: string | null;
  has_engine: boolean;
  engine_connected: boolean;
  recording_devices: { id: string; name: string; index: number }[];
  playout_devices: { id: string; name: string; index: number }[];
  attached_tracks: number;
  participants: number;
  processing: { instances: number; echo_cancellation: boolean; auto_gain_control: boolean;
    webrtc_noise_suppression: boolean; rnnoise: boolean; mix: number } | null;
}

/** Instant diagnostics, available through getVoiceNativeDebug after importing this service. */
export function getVoiceNativeDebug(): Promise<VoiceNativeDebug> {
  return tauriInvoke<VoiceNativeDebug>("voice_native_debug");
}

export function voiceNativeConnect(
  url: string,
  token: string,
  roomName: string,
  displayName: string,
  encrypted = false,
  devices?: { inputDevice: string; outputDevice: string },
  processing?: NativeAudioProcessing,
  audioQuality?: AudioQualityPreset,
): Promise<VoiceNativeStatus> {
  return tauriInvoke<VoiceNativeStatus>("voice_native_connect", {
    url,
    token,
    roomName,
    displayName,
    encrypted,
    ...devices,
    ...(processing ? { processing } : {}),
    ...(audioQuality ? { audioQuality } : {}),
  });
}

export function voiceNativeDisconnect(): Promise<VoiceNativeStatus> {
  return tauriInvoke<VoiceNativeStatus>("voice_native_disconnect");
}

export function setVoiceNativeMuted(muted: boolean): Promise<VoiceNativeStatus> {
  return tauriInvoke<VoiceNativeStatus>("voice_native_set_muted", { muted });
}

/** Hide or restore received share video; hiding stops server delivery and saves data/power. */
export function setVoiceNativeShareVideoVisible(sender: string, visible: boolean): Promise<boolean> {
  return tauriInvoke<boolean>("voice_native_set_screenshare_video_visible", { sender, visible });
}

/** Push-to-talk keeps capture open while muted so speech begins immediately on keypress. */
export function setVoiceNativeCaptureMaintenue(active: boolean): Promise<void> {
  return tauriInvoke<void>("voice_native_capture_maintenue", { active });
}

export function setVoiceNativeDeafened(deafened: boolean): Promise<VoiceNativeStatus> {
  return tauriInvoke<VoiceNativeStatus>("voice_native_set_deafened", { deafened });
}

/**
 * Import a base64-encoded raw MatrixRTC key of 16 or 32 bytes.
 * See Rust validate_e2ee_key.
 */
export function setVoiceNativeE2EEKey(
  identity: string,
  keyIndex: number,
  keyB64: string,
): Promise<boolean> {
  return tauriInvoke<boolean>("voice_native_set_e2ee_key", {
    identity,
    keyIndex,
    keyB64,
  });
}

export async function onVoiceNativeStatus(
  cb: (status: VoiceNativeStatus) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativeStatus>(VOICE_NATIVE_STATUS_EVENT, (e) => cb(e.payload));
}

export async function onVoiceNativeParticipants(
  cb: (participants: ParticipantInfo[]) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ParticipantInfo[]>(VOICE_NATIVE_PARTICIPANTS_EVENT, (e) => cb(e.payload));
}

/**
 * Departure reason emitted before the participant list: perdu=true for loss,
 * false for voluntary departure, or null when the reason is ambiguous.
 */
export interface VoiceNativeParticipantLeft {
  identity: string;
  perdu: boolean | null;
}

export async function onVoiceNativeParticipantLeft(
  cb: (ev: VoiceNativeParticipantLeft) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativeParticipantLeft>("voice-native-participant-left", (e) => cb(e.payload));
}

/**
 * Session-loss event emitted before disconnected state. reprendre requests
 * automatic rejoin after network or server loss.
 */
export interface VoiceNativeSessionPerdue { raison: string; reprendre: boolean }
export async function onVoiceNativeSessionPerdue(
  cb: (ev: VoiceNativeSessionPerdue) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativeSessionPerdue>("voice-native-session-perdue", (e) => cb(e.payload));
}

export async function onVoiceNativeE2eeState(
  cb: (ev: VoiceNativeE2eeState) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativeE2eeState>("voice-native-e2ee-state", (e) => cb(e.payload));
}

export async function onVoiceNativeData(
  cb: (ev: VoiceNativeData) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  // Rust serializes the enum with type=data_received and flat fields.
  return listen<VoiceNativeData & { type?: string }>(VOICE_NATIVE_DATA_EVENT, (e) =>
    cb({ topic: e.payload.topic ?? null, payload_b64: e.payload.payload_b64, sender: e.payload.sender ?? null }),
  );
}

export async function onVoiceNativeLocalShareFailed(
  cb: (ev: VoiceNativeLocalShareFailed) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativeLocalShareFailed>(VOICE_NATIVE_LOCAL_SHARE_FAILED_EVENT, (e) =>
    cb(e.payload),
  );
}

/** `{ sender }` — fin de partage (unsubscribe, leave, fin de piste). */
export const VOICE_NATIVE_FRAME_STOPPED_EVENT = "voice-native-frame-stopped";

/** Share mute/volume changed in the engine; synchronize the main view and native PIP. */
export const VOICE_NATIVE_SHARE_AUDIO_EVENT = "voice-native-share-audio";

export interface VoiceNativeShareAudio {
  sender: string;
  muted: boolean;
  volume: number;
}

export async function onVoiceNativeShareAudio(
  cb: (ev: VoiceNativeShareAudio) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativeShareAudio>(VOICE_NATIVE_SHARE_AUDIO_EVENT, (e) =>
    cb(e.payload),
  );
}

/** Native PIP state follows self-closing controls such as Home, right-click or Escape. */
export const VOICE_NATIVE_PIP_EVENT = "voice-native-pip";

export interface VoiceNativePipState {
  open: boolean;
  /** Displayed stream identity: screen-share sender or camera:... key. */
  sender?: string | null;
  sources?: string[];
}

export interface NativePipStream { sender: string; name: string }

export async function pipNativeOpenStreams(streams: NativePipStream[], focus: string | null): Promise<boolean> {
  try {
    await tauriInvoke("pip_native_open_streams", { streams: streams.map((s) => ({ ...s, name: [...s.name].slice(0, 256).join("") })), focus });
    return true;
  } catch (error) {
    console.warn("[Sion][PIP] diffusion indisponible", error);
    return false;
  }
}

export async function pipNativeSources(): Promise<string[]> {
  try { return await tauriInvoke<string[]>("pip_native_sources"); }
  catch { return []; }
}

export async function onVoiceNativePip(
  cb: (ev: VoiceNativePipState) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativePipState>(VOICE_NATIVE_PIP_EVENT, (e) => cb(e.payload));
}

export interface VoiceNativeFrameStopped {
  sender: string;
}

export interface VoiceNativeBinaryFrame {
  sender: string;
  width: number;
  height: number;
  jpeg: Uint8Array;
  receivedAt: number;
}

export interface VoiceNativeFrameSize {
  sender: string;
  width: number;
  height: number;
}

interface NativeVideoSurfaceRegistration {
  id: string;
  sender: string;
  element: HTMLCanvasElement;
}

interface NativeVideoSurfaceRect {
  id: string;
  sender: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Zones que la page recouvre : Rust y perce la surface. */
  holes: ZonePage[];
}

const nativeSurfaceRegistrations = new Map<string, NativeVideoSurfaceRegistration>();
const nativeSurfaceSizes = new Map<string, { width: number; height: number }>();
let nativeSurfaceSequence = 0;
let nativeSurfaceTimer: number | null = null;
let nativeSurfaceResizeObserver: ResizeObserver | null = null;
let nativeSurfaceWindowObserversActive = false;
let nativeSurfaceLastPayload = "";
let nativeSurfaceAvailablePromise: Promise<boolean> | null = null;
let nativeSurfaceSizeListenerPromise: Promise<void> | null = null;

/**
 * The embedded renderer is available only after Rust installs its GtkOverlay.
 * Availability stays stable for the page lifetime.
 */
export function isNativeVideoSurfaceAvailable(): Promise<boolean> {
  if (!nativeSurfaceAvailablePromise) {
    nativeSurfaceAvailablePromise = tauriInvoke<boolean>("native_video_surface_available")
      .catch(() => false);
  }
  return nativeSurfaceAvailablePromise;
}

function applyNativeFrameSize(sender: string, width: number, height: number) {
  // WebRTC may briefly emit an 8x8 sentinel frame during republishing.
  // Render it without changing DOM aspect ratio or making grid tiles jump to square.
  if (width < 64 || height < 64) return;
  nativeSurfaceSizes.set(sender, { width, height });
  for (const registration of nativeSurfaceRegistrations.values()) {
    if (registration.sender !== sender) continue;
    // Native surfaces own pixels. Keep the canvas backing store at 1x1 to avoid
    // WebKit compositing video-sized buffers; preserve source dimensions as metadata.
    registration.element.dataset.nativeVideoWidth = String(width);
    registration.element.dataset.nativeVideoHeight = String(height);
    // Grid tiles already have layout aspect ratios. Only an unconstrained single view
    // uses source dimensions; mark it so later source-size changes can update its ratio.
    if (!registration.element.style.aspectRatio || registration.element.dataset.nativeAspectManaged === "true") {
      registration.element.style.aspectRatio = `${width} / ${height}`;
      registration.element.dataset.nativeAspectManaged = "true";
      // Keep the element box equal to the visible image. max-height alone can leave
      // side bands outside the video and produce invalid pointer coordinates.
      // Also cap width by maximum height times aspect ratio.
      registration.element.style.maxWidth =
        `min(100%, calc(var(--sion-share-max-height, 100vh) * ${width / height}))`;
    }
    registration.element.width = 1;
    registration.element.height = 1;
  }
}

function ensureNativeSurfaceSizeListener(): Promise<void> {
  if (!nativeSurfaceSizeListenerPromise) {
    nativeSurfaceSizeListenerPromise = import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        await listen<VoiceNativeFrameSize>("voice-native-frame-size", (event) => {
          const frame = event.payload;
          applyNativeFrameSize(frame.sender, frame.width, frame.height);
        });
      })
      .catch((error) => {
        nativeSurfaceSizeListenerPromise = null;
        throw error;
      });
  }
  return nativeSurfaceSizeListenerPromise;
}

/** Mouse gesture received by the native Windows video window. */
interface GesteSurface {
  genre: "down" | "dblclick" | "move" | "up" | "annule";
  x: number;
  y: number;
}

let rejeuSourisPromise: Promise<void> | null = null;

/**
 * Whether this event was replayed from the Windows surface. Rust already
 * publishes cursor positions and clicks there; frontend publishers must skip it
 * to avoid duplicate click ripples.
 */
export function estRejoue(e: Event): boolean {
  return (e as Event & { sionRejoue?: boolean }).sionRejoue === true;
}

/**
 * Replay mouse gestures captured by the Windows video surface into the page.
 * WebView2 lives in another process, so HTTRANSPARENT cannot pass them through.
 * Replay mousedown, mouseup, click on the common ancestor, and dblclick
 * on the second click. Linux's surface already passes mouse input through.
 */
function ensureRejeuSouris(): Promise<void> {
  if (!rejeuSourisPromise) {
    let enfonce: Element | null = null;
    let double = false;
    const envoyer = (type: string, x: number, y: number, cible: EventTarget) => {
      const boutons = type === "mousedown" || type === "mousemove" ? 1 : 0;
      const evenement = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: boutons,
        detail: type === "dblclick" || double ? 2 : 1,
        view: window,
      });
      Object.defineProperty(evenement, "sionRejoue", { value: true });
      cible.dispatchEvent(evenement);
    };
    const ancetreCommun = (a: Element, b: Element): Element => {
      for (let e: Element | null = a; e; e = e.parentElement) {
        if (e.contains(b)) return e;
      }
      return document.documentElement;
    };
    rejeuSourisPromise = import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        await listen<GesteSurface>("surface-native-souris", ({ payload: { genre, x, y } }) => {
          const sous = document.elementFromPoint(x, y);
          switch (genre) {
            case "down":
            case "dblclick":
              if (!sous) return;
              enfonce = sous;
              double = genre === "dblclick";
              envoyer("mousedown", x, y, sous);
              break;
            case "move":
              envoyer("mousemove", x, y, sous ?? document);
              break;
            // When capture is lost during a press, release to end dragging but emit no click.
            case "annule":
              envoyer("mouseup", x, y, sous ?? document);
              enfonce = null;
              double = false;
              break;
            case "up": {
              envoyer("mouseup", x, y, sous ?? document);
              if (enfonce && sous) {
                const cible = ancetreCommun(enfonce, sous);
                envoyer("click", x, y, cible);
                if (double) envoyer("dblclick", x, y, cible);
              }
              enfonce = null;
              double = false;
              break;
            }
          }
        });
      })
      .catch((error) => {
        rejeuSourisPromise = null;
        throw error;
      });
  }
  return rejeuSourisPromise;
}

/**
 * Compute the visible element rectangle by intersecting clipping ancestors.
 * getBoundingClientRect ignores clipping, and native surfaces would otherwise
 * paint over sidebars, rounded cards or hidden panels.
 */
function rectVisible(element: Element): DOMRect {
  let visible = element.getBoundingClientRect();
  // Stop ancestor clipping at the fullscreen element. It leaves normal composition
  // even though DOM parents remain; clipping against the message list would shrink fullscreen video.
  const plein = document.fullscreenElement;
  const sousPlein = plein?.contains(element) ?? false;
  // Clip only ancestors that contain the box in CSS. Fixed elements escape
  // ordinary ancestors; absolute elements escape ancestors that are not positioned.
  let position = getComputedStyle(element).position;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (sousPlein && (ancestor === plein || !plein!.contains(ancestor))) break;
    const ancestorStyle = getComputedStyle(ancestor);
    const contient = position === "fixed"
      ? contientLesFixes(ancestorStyle)
      : position === "absolute"
        ? ancestorStyle.position !== "static" || contientLesFixes(ancestorStyle)
        : true;
    if (!contient) continue;
    position = ancestorStyle.position;
    const clipsX = ancestorStyle.overflowX !== "visible";
    const clipsY = ancestorStyle.overflowY !== "visible";
    if (!clipsX && !clipsY) continue;
    const clip = ancestor.getBoundingClientRect();
    if (clipsX) {
      visible = new DOMRect(
        Math.max(visible.left, clip.left),
        visible.top,
        Math.min(visible.right, clip.right) - Math.max(visible.left, clip.left),
        visible.height,
      );
    }
    if (clipsY) {
      visible = new DOMRect(
        visible.left,
        Math.max(visible.top, clip.top),
        visible.width,
        Math.min(visible.bottom, clip.bottom) - Math.max(visible.top, clip.top),
      );
    }
    if (visible.width <= 0 || visible.height <= 0) break;
  }
  return visible;
}

/**
 * Whether this ancestor establishes a fixed-position containing block
 * through transforms, filters or containment.
 */
function contientLesFixes(style: CSSStyleDeclaration): boolean {
  return style.transform !== "none"
    || style.filter !== "none"
    || /paint|layout|strict|content/.test(style.contain)
    || /transform|filter/.test(style.willChange);
}

/** Zone de la page, en pixels CSS de la vue. */
interface ZonePage {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Layers that may cover video, including CSS-positioned panels in narrow windows. */
const SELECTEUR_CALQUES =
  '.sion-panneau, [class*="fixed"], [class*="absolute"], [style*="position: fixed"], [style*="position: absolute"]';

/** Match the Rust hole limit; beyond it, use one bounding rectangle. */
const TROUS_MAX = 16;

/** Sample the center and four interior points, avoiding rounded-border corners. */
function echantillons(left: number, top: number, width: number, height: number): Array<[number, number]> {
  return [
    [left + width / 2, top + height / 2],
    [left + width * 0.25, top + height * 0.25],
    [left + width * 0.75, top + height * 0.25],
    [left + width * 0.25, top + height * 0.75],
    [left + width * 0.75, top + height * 0.75],
  ];
}

/** An element's layer is its nearest out-of-flow ancestor, or itself. */
function calqueDe(element: Element, video: Element): Element {
  for (let e: Element | null = element; e && !e.contains(video); e = e.parentElement) {
    const position = getComputedStyle(e).position;
    if (position === "fixed" || position === "absolute") return e;
  }
  return element;
}

/**
 * Find page regions covering video, or return null for full occlusion.
 * Native painting sits above the webview, so Rust cuts holes for menus and dialogs.
 * Allow video-container controls. elementFromPoint honors pointer-events:none
 * so decorative layers do not cut holes.
 */
function trousSur(element: HTMLCanvasElement, left: number, top: number, width: number, height: number): ZonePage[] | null {
  const right = left + width;
  const bottom = top + height;
  const conteneur = element.parentElement;
  const plein = document.fullscreenElement;
  const retenus: Element[] = [];
  const trous: ZonePage[] = [];
  const retenir = (calque: Element) => {
    if (retenus.some((r) => r.contains(calque))) return;
    const r = rectVisible(calque);
    const gauche = Math.floor(Math.max(left, r.left));
    const haut = Math.floor(Math.max(top, r.top));
    const droite = Math.ceil(Math.min(right, r.right));
    const bas = Math.ceil(Math.min(bottom, r.bottom));
    if (droite <= gauche || bas <= haut) return;
    for (let i = retenus.length - 1; i >= 0; i--) {
      if (calque.contains(retenus[i])) {
        retenus.splice(i, 1);
        trous.splice(i, 1);
      }
    }
    retenus.push(calque);
    trous.push({ x: gauche, y: haut, width: droite - gauche, height: bas - haut });
  };
  const etranger = (e: Element) => e !== element && !(conteneur?.contains(e) ?? false);

  for (const calque of document.querySelectorAll(SELECTEUR_CALQUES)) {
    if (!etranger(calque) || calque.contains(element)) continue;
    // Elements outside fullscreen are hidden beneath its top layer.
    if (plein && !plein.contains(calque)) continue;
    const r = calque.getBoundingClientRect();
    const gauche = Math.max(left, r.left);
    const haut = Math.max(top, r.top);
    const droite = Math.min(right, r.right);
    const bas = Math.min(bottom, r.bottom);
    if (droite <= gauche || bas <= haut) continue;
    // Only layers in front of video should create holes; a layer beneath it
    // would reveal the canvas's black background instead of the image.
    const devant = echantillons(gauche, haut, droite - gauche, bas - haut).some(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && calque.contains(hit);
    });
    if (devant) retenir(calque);
  }
  // Catch foreground elements missed by the layer selector.
  for (const [x, y] of echantillons(left, top, width, height)) {
    const hit = document.elementFromPoint(x, y);
    // A point outside the viewport has no element and does not imply occlusion.
    if (!hit || !etranger(hit) || hit.contains(element)) continue;
    retenir(calqueDe(hit, element));
  }

  if (trous.some((t) => t.x <= left && t.y <= top && t.x + t.width >= right && t.y + t.height >= bottom)) {
    return null;
  }
  if (trous.length > TROUS_MAX) {
    const x = Math.min(...trous.map((t) => t.x));
    const y = Math.min(...trous.map((t) => t.y));
    const width = Math.max(...trous.map((t) => t.x + t.width)) - x;
    const height = Math.max(...trous.map((t) => t.y + t.height)) - y;
    return [{ x, y, width, height }];
  }
  return trous;
}

function nativeSurfaceLoop() {
  nativeSurfaceTimer = null;
  const surfaces: NativeVideoSurfaceRect[] = [];
  for (const registration of nativeSurfaceRegistrations.values()) {
    const element = registration.element;
    const style = getComputedStyle(element);
    if (!element.isConnected || style.display === "none" || style.visibility === "hidden") continue;
    const visible = rectVisible(element);
    const left = Math.max(0, visible.left);
    const top = Math.max(0, visible.top);
    const right = Math.min(window.innerWidth, visible.right);
    const bottom = Math.min(window.innerHeight, visible.bottom);
    const width = Math.round(right - left);
    const height = Math.round(bottom - top);
    if (width < 1 || height < 1) continue;
    let holes: ZonePage[] | null;
    try {
      holes = trousSur(element, left, top, width, height);
    } catch (error) {
      // Catch errors so geometry updates continue; otherwise video stays
      // at its last rectangle over subsequently opened UI.
      console.warn("[Sion][partage-natif] calcul des trous impossible", error);
      holes = [];
    }
    if (!holes) continue;
    surfaces.push({
      id: registration.id,
      sender: registration.sender,
      x: Math.round(left),
      y: Math.round(top),
      width,
      height,
      holes,
    });
  }
  const payload = JSON.stringify(surfaces);
  if (payload !== nativeSurfaceLastPayload) {
    nativeSurfaceLastPayload = payload;
    void tauriInvoke<boolean>("native_video_surfaces_set", { surfaces }).catch(() => false);
  }
  if (nativeSurfaceRegistrations.size > 0) {
    // Check geometry four times per second instead of running a permanent rAF.
    // This follows resize/scroll/transitions without continuous WebKit/GTK composition.
    nativeSurfaceTimer = window.setTimeout(nativeSurfaceLoop, 250);
  }
}

function startNativeSurfaceLoop() {
  if (nativeSurfaceRegistrations.size === 0) return;
  if (nativeSurfaceTimer !== null) window.clearTimeout(nativeSurfaceTimer);
  nativeSurfaceTimer = window.setTimeout(nativeSurfaceLoop, 0);
}

/**
 * After clicks or keys, update geometry on the next frame once React mounts
 * the menu; do not wait a quarter-second with native video covering it.
 */
function apresInteraction(event: Event) {
  // Typing in an input does not open menus; avoid rescanning the page for every character.
  if (event.type === "keydown") {
    const cible = event.target;
    if (cible instanceof HTMLElement
      && (cible.isContentEditable || cible.tagName === "INPUT" || cible.tagName === "TEXTAREA")) {
      return;
    }
  }
  requestAnimationFrame(startNativeSurfaceLoop);
}

const INTERACTIONS = ["pointerdown", "click", "contextmenu", "keydown"] as const;

function ensureNativeSurfaceGeometryObservers() {
  if (!nativeSurfaceResizeObserver) {
    nativeSurfaceResizeObserver = new ResizeObserver(startNativeSurfaceLoop);
  }
  if (!nativeSurfaceWindowObserversActive) {
    window.addEventListener("resize", startNativeSurfaceLoop, { passive: true });
    window.addEventListener("scroll", startNativeSurfaceLoop, { passive: true, capture: true });
    for (const type of INTERACTIONS) {
      window.addEventListener(type, apresInteraction, { passive: true, capture: true });
    }
    nativeSurfaceWindowObserversActive = true;
  }
}

/**
 * Register the DOM rectangle receiving native pixels. Send geometry only
 * when changed; no pixel data crosses IPC.
 */
export async function registerNativeVideoSurface(
  element: HTMLCanvasElement,
  sender: string,
): Promise<() => void> {
  if (!sender || !(await isNativeVideoSurfaceAvailable())) return () => {};
  // Install the listener before publishing the surface so the initial
  // and potentially only size event cannot be missed.
  await ensureNativeSurfaceSizeListener();
  void ensureRejeuSouris().catch(() => { /* hors Tauri */ });
  const id = `native-video-${++nativeSurfaceSequence}`;
  // Mark the native placeholder; letterbox calculations must not use its tiny backing store.
  element.dataset.nativeSurface = "true";
  nativeSurfaceRegistrations.set(id, { id, sender, element });
  ensureNativeSurfaceGeometryObservers();
  nativeSurfaceResizeObserver?.observe(element);
  console.info(`[Sion][partage-natif] surface DOM enregistrée ${id} pour ${sender}`);
  const knownSize = nativeSurfaceSizes.get(sender);
  if (knownSize) applyNativeFrameSize(sender, knownSize.width, knownSize.height);
  startNativeSurfaceLoop();
  return () => {
    nativeSurfaceResizeObserver?.unobserve(element);
    delete element.dataset.nativeSurface;
    nativeSurfaceRegistrations.delete(id);
    console.info(`[Sion][partage-natif] surface DOM retirée ${id} pour ${sender}`);
    if (nativeSurfaceRegistrations.size === 0) {
      if (nativeSurfaceTimer !== null) window.clearTimeout(nativeSurfaceTimer);
      nativeSurfaceTimer = null;
      nativeSurfaceResizeObserver?.disconnect();
      nativeSurfaceResizeObserver = null;
      if (nativeSurfaceWindowObserversActive) {
        window.removeEventListener("resize", startNativeSurfaceLoop);
        window.removeEventListener("scroll", startNativeSurfaceLoop, true);
        for (const type of INTERACTIONS) window.removeEventListener(type, apresInteraction, true);
        nativeSurfaceWindowObserversActive = false;
      }
      nativeSurfaceLastPayload = "[]";
      void tauriInvoke<boolean>("native_video_surfaces_set", { surfaces: [] }).catch(() => false);
    }
  };
}

export function parseVoiceNativeVideoPacket(data: ArrayBuffer): VoiceNativeBinaryFrame | null {
  if (data.byteLength < 14) return null;
  const bytes = new Uint8Array(data);
  if (bytes[0] !== 0x53 || bytes[1] !== 0x56 || bytes[2] !== 0x46 || bytes[3] !== 0x31) return null;
  const view = new DataView(data);
  const senderLength = view.getUint16(4, true);
  const jpegOffset = 14 + senderLength;
  if (jpegOffset + 4 > data.byteLength) return null;
  const width = view.getUint32(6, true);
  const height = view.getUint32(10, true);
  if (!width || !height) return null;
  const sender = new TextDecoder().decode(bytes.subarray(14, jpegOffset));
  if (!sender) return null;
  // Reject malformed frames before handing them to ImageBitmap. This keeps a
  // bad/partial packet from repeatedly clearing the canvas and makes the
  // black-screen failure mode observable in logs instead of silent.
  const jpeg = bytes.subarray(jpegOffset);
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) return null;
  return {
    sender,
    width,
    height,
    jpeg: jpeg.slice(),
    receivedAt: performance.now(),
  };
}

/**
 * Open binary local JPEG transport without JSON/base64.
 * Reserve Tauri IPC for small control events.
 */
/**
 * On Android, use internal sion-video requests when Chromium blocks
 * the local WebSocket. Each response carries the latest sequence and
 * new frames since the previous request, keeping the latest per sender.
 */
function lireImagesParRequetes(onFrame: (frame: VoiceNativeBinaryFrame) => void): () => void {
  let actif = true;
  let vu = 0;
  let premiere = true;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  void (async () => {
    while (actif) {
      try {
        const reponse = await fetch(`http://sion-video.localhost/?vu=${vu}`, { cache: "no-store" });
        const octets = await reponse.arrayBuffer();
        if (octets.byteLength < 8) { await pause(500); continue; }
        const vue = new DataView(octets);
        vu = Number(vue.getBigUint64(0, true));
        let position = 8;
        let recues = 0;
        while (position + 4 <= octets.byteLength) {
          const longueur = vue.getUint32(position, true);
          position += 4;
          const frame = parseVoiceNativeVideoPacket(octets.slice(position, position + longueur));
          position += longueur;
          if (!frame) continue;
          recues++;
          if (premiere) {
            premiere = false;
            console.info(`[Sion][partage-natif] première frame reçue (requêtes) ${frame.sender} ${frame.width}x${frame.height}`);
          }
          onFrame(frame);
        }
        // No new frame: wait roughly one source frame interval.
        if (recues === 0) await pause(40);
      } catch {
        await pause(500);
      }
    }
  })();
  return () => { actif = false; };
}

export async function connectVoiceNativeVideoStream(
  onFrame: (frame: VoiceNativeBinaryFrame) => void,
): Promise<() => void> {
  if (/Android/i.test(navigator.userAgent)) return lireImagesParRequetes(onFrame);
  const port = await tauriInvoke<number>("voice_native_video_port");
  if (!port) throw new Error("transport vidéo natif indisponible");
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.binaryType = "arraybuffer";
  let loggedFrame = false;
  let invalidPackets = 0;
  socket.onmessage = (event) => {
    // WebKitGTK has shipped versions that return Blob here even after
    // binaryType="arraybuffer". Accept both forms; otherwise Rust sends valid
    // frames but the canvas stays black with no visible error.
    const data = event.data;
    const consume = (bytes: ArrayBuffer) => {
      const frame = parseVoiceNativeVideoPacket(bytes);
      if (frame) {
        if (!loggedFrame) {
          loggedFrame = true;
          console.info(`[Sion][partage-natif] première frame reçue ${frame.sender} ${frame.width}x${frame.height} ${frame.jpeg.byteLength} o`);
        }
        onFrame(frame);
      } else if (invalidPackets++ < 3) {
        console.warn("[Sion][partage-natif] paquet vidéo invalide", bytes.byteLength);
      }
    };
    if (data instanceof ArrayBuffer) {
      consume(data);
    } else if (data && typeof (data as { arrayBuffer?: unknown }).arrayBuffer === "function") {
      // Cross-realm WebKit objects can fail `instanceof Blob`; feature-test
      // arrayBuffer instead so the binary payload is still consumed.
      void (data as Blob).arrayBuffer().then(consume).catch(() => {
        if (invalidPackets++ < 3) console.warn("[Sion][partage-natif] lecture Blob vidéo impossible");
      });
    } else if (invalidPackets++ < 3) {
      console.warn("[Sion][partage-natif] paquet vidéo non-binaire", typeof data);
    }
  };
  return () => {
    socket.onmessage = null;
    socket.close();
  };
}

export async function onVoiceNativeFrameStopped(
  cb: (ev: VoiceNativeFrameStopped) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceNativeFrameStopped>(VOICE_NATIVE_FRAME_STOPPED_EVENT, (e) =>
    cb(e.payload),
  );
}

/** Map native quality strings to the frontend's LiveKit-compatible type. */
export function toConnectionQuality(q: string): ConnectionQuality {
  switch (q) {
    case "excellent":
    case "good":
    case "poor":
    case "lost":
      return q;
    default:
      return "unknown";
  }
}

/** Extract a Matrix user ID from @user:server[:device], matching ChannelItem's filter. */
export function matrixUserIdOf(identity: string): string {
  return identity.match(/^(@[^:]+:[^:]+)/)?.[1] ?? identity;
}

/**
 * Resolve the participant's room display name, then global name, then localpart.
 * Use map reads so every cursor packet can obtain a short name cheaply.
 */
export function resolveNativeDisplayName(identity: string, roomId: string | null): string {
  const userId = matrixUserIdOf(identity);
  try {
    const client = getMatrixClient();
    if (roomId) {
      const memberName = (client
        ? client.getRoom(roomId)?.getMember?.(userId)?.name
        : getRoomMemberInfo(roomId, userId).displayName)?.trim();
      if (memberName && !/^@[^:]+:[^:]+(?::.+)?$/.test(memberName)) return memberName;
    }
    if (client) {
      const globalName = client.getUser(userId)?.displayName;
      if (globalName && !/^@[^:]+:[^:]+(?::.+)?$/.test(globalName)) return globalName;
    }
  } catch { /* ignore — repli localpart ci-dessous */ }
  return userId.replace("@", "").split(":")[0] || identity;
}

export interface MatrixVoiceUserState {
  id: string;
  muted: boolean;
  deafened: boolean;
  /** Per-device state, with one call.member entry per known device. */
  devices?: { id: string; muted: boolean; deafened: boolean }[];
}

/**
 * Merge persistent Matrix call.member mute/deafen state with native participant state.
 * Missed data-channel broadcasts during join must not hide deafen for the whole call.
 * Use logical OR; membership expiry and heartbeats remove stale true values.
 * Return the original list reference when unchanged to avoid unnecessary renders.
 */
export function overlayMatrixVoiceState(
  participants: ParticipantInfo[],
  voiceUsers: MatrixVoiceUserState[],
): ParticipantInfo[] {
  if (voiceUsers.length === 0) return participants;
  const byUser = new Map(voiceUsers.map((u) => [u.id, u]));
  let touched = false;
  const out = participants.map((p) => {
    const u = byUser.get(matrixUserIdOf(p.identity));
    if (!u) return p;
    // Use this device's state: a muted desktop must not override the same
    // account's unmuted phone. Unknown Matrix devices add no state.
    const appareil = appareilDeIdentite(p.identity);
    const etat = u.devices?.length ? u.devices.find((d) => d.id === appareil) : u;
    if (!etat) return p;
    const isMuted = p.isMuted || etat.muted;
    const isDeafened = p.isDeafened || etat.deafened;
    if (isMuted === p.isMuted && isDeafened === p.isDeafened) return p;
    touched = true;
    return { ...p, isMuted, isDeafened };
  });
  return touched ? out : participants;
}

// Native always-on-top PIP, painted from Rust-side BGRA frames without webview transfers.

export async function pipNativeClose(): Promise<void> {
  try {
    await tauriInvoke<null>("pip_native_close");
  } catch {
    /* Nothing to close outside Tauri. */
  }
}

/** Native video-player state reported by Rust. */
export interface EtatLecteurVideo {
  actif: boolean;
  largeur: number;
  hauteur: number;
  duree_ms: number;
  position_ms: number;
  en_pause: boolean;
  /** False for silent media or when no usable output device exists. */
  a_du_son: boolean;
}

/** Player stream ID; keep identical to Rust SENDER_LECTEUR. */
export const SENDER_LECTEUR = "sion:lecteur";

/** Player download progress; total is zero when the server omits content length. */
export interface ProgresVideo {
  source: string;
  recus: number;
  total: number;
}

/**
 * Download video to disk with progress and caching before playback.
 * The bundled statically linked ffmpeg has unreliable DNS resolution, so Rust
 * fetches URLs asynchronously to keep the UI responsive and avoid repeat downloads.
 */
export async function precharcherVideo(
  source: string,
  onProgres?: (p: ProgresVideo) => void,
): Promise<string> {
  if (!onProgres) return tauriInvoke<string>("lecteur_video_precharger", { chemin: source });
  const { listen } = await import("@tauri-apps/api/event");
  const stop = await listen<ProgresVideo>("lecteur-video-progres", (e) => {
    if (e.payload.source === source) onProgres(e.payload);
  });
  try {
    return await tauriInvoke<string>("lecteur_video_precharger", { chemin: source });
  } finally {
    stop();
  }
}

/**
 * Open local or remote video in the native player. Remote sources are downloaded
 * first; precharcherVideo can warm the cache. Decode outside the webview and paint
 * native surfaces; see docs/lecteur-video-natif.md.
 */
export async function ouvrirLecteurVideo(source: string): Promise<EtatLecteurVideo> {
  const { useSettingsStore } = await import("../stores/useSettingsStore");
  return tauriInvoke<EtatLecteurVideo>("lecteur_video_ouvrir", {
    chemin: source,
    ffmpegPath: useSettingsStore.getState().ffmpegPath || undefined,
  });
}

/** Stop playback and release the surface; safe to call when already stopped. */
export function fermerLecteurVideo(): Promise<void> {
  return tauriInvoke<void>("lecteur_video_fermer");
}

/** Current position and duration for the progress bar. */
export function etatLecteurVideo(): Promise<EtatLecteurVideo> {
  return tauriInvoke<EtatLecteurVideo>("lecteur_video_etat");
}

/**
 * Pause or resume playback. Resume restarts ffmpeg at the saved position
 * so its -re clock does not catch up the paused interval at full speed
 * and desynchronize video/audio. Restart may take a few tenths of a second.
 */
export function pauseLecteurVideo(enPause: boolean): Promise<EtatLecteurVideo> {
  return tauriInvoke<EtatLecteurVideo>("lecteur_video_pause", { enPause });
}

/**
 * Physical display size. When fullscreen exceeds source resolution, Rust
 * restarts at the current position with a larger canvas to keep video controls sharp.
 * No-op for unchanged size; returns state including the new canvas dimensions.
 */
export function resolutionLecteurVideo(largeur: number, hauteur: number): Promise<EtatLecteurVideo> {
  return tauriInvoke<EtatLecteurVideo>("lecteur_video_resolution", {
    largeur: Math.max(1, Math.round(largeur)),
    hauteur: Math.max(1, Math.round(hauteur)),
  });
}

/** Volume from 0 to 1.5; values above one amplify audio. */
export function volumeLecteurVideo(valeur: number): Promise<void> {
  return tauriInvoke<void>("lecteur_video_volume", { valeur });
}

/** Seek by restarting ffmpeg at the requested position; expect a short startup delay. */
export function seekLecteurVideo(positionMs: number): Promise<EtatLecteurVideo> {
  return tauriInvoke<EtatLecteurVideo>("lecteur_video_seek", { positionMs: Math.max(0, Math.round(positionMs)) });
}

/** Embedded control layout in media pixels; Rust drawing and page hit areas must agree. */
export interface ZonesLecteur {
  bandeau_y: number;
  bandeau_h: number;
  barre_h: number;
  /** Track center measured from the control strip's top edge. */
  barre_y: number;
  bouton_x: number;
  bouton_l: number;
  /** Inset track geometry matching the rest of the row. */
  barre_x: number;
  barre_l: number;
  /** Speaker icon followed by the optional volume gauge. */
  volume_x: number;
  volume_l: number;
  /** Gauge track used to read the volume level. */
  jauge_x: number;
  jauge_l: number;
  compteur_x: number;
  compteur_l: number;
  /** "complet" | "court" | "aucun" */
  compteur: string;
  /** Square close button in the image's top-right corner. */
  fermer_x: number;
  fermer_y: number;
  fermer_l: number;
  plein_x: number;
  plein_l: number;
  rangee_y: number;
  taille: number;
  avec_jauge: boolean;
}

/**
 * Declare display size and control layout. echelle is screen pixels per media
 * pixel, keeping controls readable after scaling. densite is devicePixelRatio
 * for physical-resolution drawing; pleinEcran selects the fullscreen button icon.
 */
export function zonesLecteurVideo(
  largeur: number,
  hauteur: number,
  echelle: number,
  densite: number,
  pleinEcran: boolean,
): Promise<ZonesLecteur> {
  return tauriInvoke<ZonesLecteur>("lecteur_video_zones", {
    largeur,
    hauteur,
    echelle,
    densite,
    pleinEcran,
  });
}

/**
 * Cached JPEG/base64 video poster extracted by ffmpeg because the server's
 * thumbnail route returns the whole video. Request only for visible cards.
 */
export async function afficheLecteurVideo(source: string): Promise<string> {
  const { useSettingsStore } = await import("../stores/useSettingsStore");
  const b64 = await tauriInvoke<string>("lecteur_video_affiche", {
    chemin: source,
    ffmpegPath: useSettingsStore.getState().ffmpegPath || undefined,
  });
  return `data:image/jpeg;base64,${b64}`;
}

/**
 * Seek preview position during dragging, or null when finished.
 * Only move the indicator; actual seeking waits for release.
 */
export function apercuLecteurVideo(positionMs: number | null): Promise<void> {
  return tauriInvoke<void>("lecteur_video_apercu", {
    positionMs: positionMs === null ? null : Math.max(0, Math.round(positionMs)),
  });
}
