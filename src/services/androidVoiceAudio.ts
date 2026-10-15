export interface AndroidVoiceAudioDevice { id: string; type: string; name: string }
export interface AndroidVoiceAudioState {
  running: boolean;
  selected: string;
  active: string | null;
  pending: string | null;
  devices: AndroidVoiceAudioDevice[];
  error: string | null;
  interrupted: boolean;
}
interface AudioBridge {
  voiceAudioState(): string;
  chooseVoiceAudio(id: string): boolean;
  setHeadsetButtonAction(action: string): void;
  resumeVoiceAudio?(): boolean;
}
function bridge(): AudioBridge | undefined {
  const value = (window as unknown as { __SION__?: AudioBridge }).__SION__;
  return typeof value?.voiceAudioState === "function" && typeof value.chooseVoiceAudio === "function" ? value : undefined;
}
export function readAndroidVoiceAudio(): AndroidVoiceAudioState | null {
  try {
    const api = bridge();
    if (!api) return null;
    const state = JSON.parse(api.voiceAudioState());
    if (typeof state.running !== "boolean" || typeof state.selected !== "string" || !Array.isArray(state.devices)) return null;
    return { ...state, active: state.active ?? null, pending: state.pending ?? null, error: state.error ?? null, interrupted: state.interrupted === true,
      devices: state.devices.filter((d: AndroidVoiceAudioDevice) => d && typeof d.id === "string" && typeof d.type === "string" && typeof d.name === "string") };
  } catch { return null; }
}
export function chooseAndroidVoiceAudio(id: string): boolean {
  try { return bridge()?.chooseVoiceAudio(id) === true; } catch { return false; }
}
export function resumeAndroidVoiceAudio(): boolean {
  try { return bridge()?.resumeVoiceAudio?.() === true; } catch { return false; }
}
export function watchAndroidVoiceAudio(changed: (state: AndroidVoiceAudioState | null) => void): () => void {
  if (!bridge()) { changed(null); return () => {}; }
  const refresh = () => changed(readAndroidVoiceAudio());
  // Refresh on resume as well: Android can change routes while the WebView sleeps.
  window.addEventListener("sion-voice-audio", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  const interval = setInterval(refresh, 1000);
  refresh();
  return () => {
    clearInterval(interval);
    window.removeEventListener("sion-voice-audio", refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
export type AndroidHeadsetAction = "mute" | "disconnect";
export function androidHeadsetAction(): AndroidHeadsetAction {
  return localStorage.getItem("sion-headset-action") === "disconnect" ? "disconnect" : "mute";
}
export function setAndroidHeadsetAction(action: AndroidHeadsetAction): void {
  localStorage.setItem("sion-headset-action", action);
  bridge()?.setHeadsetButtonAction?.(action);
}
