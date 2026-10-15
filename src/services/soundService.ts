/**
 * UI sound service: offline PCM synthesis and native playback.
 * Pas de fichiers audio externes nécessaires.
 */

import { useAppStore } from "../stores/useAppStore";
import { playNativeTone } from "./nativeAudioPlayback";


// Notification tones (incoming messages, pokes, remote join/leave) are
// suppressed when the user is deafened. Action-feedback tones
// (mute/unmute/deafen/undeafen toggles) always play — they confirm the user's
// own action.
function isDeafened(): boolean {
  return useAppStore.getState().isDeafened;
}


// Mic mute/unmute + deafen/undeafen feedback now lives in the customizable cue
// system (voiceChannelSounds.ts: playMuteCue/playUnmuteCue/playDeafenCue/
// playUndeafenCue) so users can swap the beeps for their own MP3s.

/** Son de message reçu — "blop" court et doux */
export function playMessageReceived() {
  if (isDeafened()) return;
  playNativeTone([{ freq: 800, start: 0, dur: 0.08 }, { freq: 1000, start: 0.05, dur: 0.06 }], "sine", 0.08);
}
