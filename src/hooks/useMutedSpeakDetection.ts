import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "../stores/useAppStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { playNativeTone } from "../services/nativeAudioPlayback";
import {
  getVoiceNativeAudioLevel,
  startVoiceNativeMicrophoneTest,
  stopVoiceNativeAudioTest,
} from "../services/voiceNativeService";

const ALERT_COOLDOWN_MS = 3000;

// Render local feedback through Rust alongside received voices.
function playMutedAlert() {
  playNativeTone([{ freq: 800, start: 0, dur: 0.08 }, { freq: 800, start: 0.15, dur: 0.08 }], "sine", 0.15);
}

export function useMutedSpeakDetection(onSpeakWhileMuted: () => void) {
  const isMuted = useAppStore((s) => s.isMuted);
  const isDeafened = useAppStore((s) => s.isDeafened);
  const connectedVoice = useAppStore((s) => s.connectedVoiceChannel);
  const mutedSpeakAlert = useSettingsStore((s) => s.mutedSpeakAlert);
  const micThreshold = useSettingsStore((s) => s.micThreshold);
  const nativeAudioInputDevice = useSettingsStore((s) => s.nativeAudioInputDevice);

  const lastAlertRef = useRef(0);
  const onSpeakRef = useRef(onSpeakWhileMuted);
  useEffect(() => { onSpeakRef.current = onSpeakWhileMuted; }, [onSpeakWhileMuted]);
  // Ref mirror of the threshold so the rAF loop picks up slider changes
  // without tearing down getUserMedia/AudioContext. Dragging the slider
  // previously re-ran the whole effect (stop tracks → ctx.close() → new
  // getUserMedia), taking ~200–500 ms each tick and making the setting
  // feel "ignored until reload".
  const micThresholdRef = useRef(micThreshold);
  useEffect(() => { micThresholdRef.current = micThreshold; }, [micThreshold]);

  const triggerAlert = useCallback(() => {
    const now = Date.now();
    if (now - lastAlertRef.current > ALERT_COOLDOWN_MS) {
      lastAlertRef.current = now;
      playMutedAlert();
      onSpeakRef.current();
    }
  }, []);

  useEffect(() => {
    // Skip when deafened: the user is intentionally AFK (mic + speakers off),
    // they don't need an alert that they're muted because they already know.
    if (!isMuted || isDeafened || !connectedVoice || !mutedSpeakAlert) return;

    // Le moteur Rust dispose déjà du RMS issu de son APM. Maintenir l'ADM en
    // capture pendant le mute permet l'alerte sans ouvrir un getUserMedia
    // concurrente et sans republier la moindre piste LiveKit.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let previousSequence = -1;
    const sample = async () => {
      try {
        const level = await getVoiceNativeAudioLevel();
        if (!stopped && level.sequence !== previousSequence && level.rms > micThresholdRef.current) {
          triggerAlert();
        }
        previousSequence = level.sequence;
      } catch (err) {
        if (!stopped) console.error("[Sion] Native muted speak detection failed:", err);
      } finally {
        if (!stopped) timer = setTimeout(sample, 50);
      }
    };
    void startVoiceNativeMicrophoneTest(nativeAudioInputDevice, "muted-speak-alert")
      .then(sample)
      .catch((err) => {
        if (!stopped) console.error("[Sion] Native muted speak capture failed:", err);
      });
    return () => {
      stopped = true;
      clearTimeout(timer);
      void stopVoiceNativeAudioTest("muted-speak-alert");
    };
    // `micThreshold` intentionally omitted — the ref above carries live
    // updates without re-running the whole capture.
     
  }, [isMuted, isDeafened, connectedVoice, mutedSpeakAlert, nativeAudioInputDevice, triggerAlert]);
}
