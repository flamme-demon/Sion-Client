import { connectVoiceNativeVideoStream, type VoiceNativeBinaryFrame } from "./voiceNativeService";

// Un seul transport pour tous les aperçus, sans état React à chaque frame.
const listeners = new Map<string, Set<(frame: VoiceNativeBinaryFrame) => void>>();
let closeStream: (() => void) | null = null;
let connecting: Promise<void> | null = null;
export function subscribeVideoFrames(key: string, callback: (frame: VoiceNativeBinaryFrame) => void) {
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(callback);
  if (!closeStream && !connecting) {
    connecting = connectVoiceNativeVideoStream((frame) => listeners.get(frame.sender)?.forEach((f) => f(frame)))
      .then((close) => { if (!listeners.size) close(); else closeStream = close; })
      .catch((error) => console.warn("[Sion][caméra] flux indisponible", error))
      .finally(() => { connecting = null; });
  }
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    set.delete(callback);
    if (!set.size) listeners.delete(key);
    if (!listeners.size) { closeStream?.(); closeStream = null; }
  };
}
