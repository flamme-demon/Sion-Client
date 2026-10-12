import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { useLiveKitStore } from "../stores/useLiveKitStore";
import { useAppStore } from "../stores/useAppStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { CAMERA_PREVIEW_KEY, cameraKey, useCameraStore } from "../services/cameraService";
import { resolveNativeDisplayName } from "../services/voiceNativeService";
import { closeNativePip, nativePipBusy, openNativeVideoPip } from "./useNativePip";

export type MeetingStream = { key: string; name: string; kind: "camera" | "screen"; hasAudio: boolean };
type MeetingState = { mode: "closed" | "internal" | "system"; selection: string[] | null; focus: string | null };
export const useVideoMeetingStore = create<MeetingState>(() => ({ mode: "closed", selection: null, focus: null }));

function displayName(identity: string, name: string, room: string | null) {
  const human = name.trim();
  return human && !/^@[^:]+:[^:]+(?::.+)?$/.test(human) ? human : resolveNativeDisplayName(identity, room);
}

export function useMeetingStreams(): MeetingStream[] {
  const { t } = useTranslation();
  const local = useCameraStore((s) => s.published);
  const localIdentity = useCameraStore((s) => s.identity);
  const room = useAppStore((s) => s.connectedVoiceChannel);
  // Les niveaux audio ne changent pas ce catalogue ; aucune frame dans React.
  const peers = useLiveKitStore(useShallow((s) => s.participants
    .filter((p) => p.isCameraEnabled || p.isScreenSharing)
    .map((p) => JSON.stringify([p.identity, p.name, !!p.isCameraEnabled, p.isScreenSharing, !!p.isScreenSharingAudio]))));
  const names = useMatrixStore(useShallow(() => peers.map((p) => {
    const [identity, name] = JSON.parse(p) as [string, string];
    return displayName(identity, name, room);
  })));
  return useMemo(() => room ? [
    ...(local ? [{ key: CAMERA_PREVIEW_KEY, name: t("camera.you"), kind: "camera" as const, hasAudio: false }] : []),
    ...peers.flatMap((p, i) => {
      const [identity, , camera, screen, audio] = JSON.parse(p) as [string, string, boolean, boolean, boolean];
      return [
        ...(camera && identity !== localIdentity ? [{ key: cameraKey(identity), name: names[i], kind: "camera" as const, hasAudio: false }] : []),
        ...(screen ? [{ key: identity, name: names[i], kind: "screen" as const, hasAudio: audio }] : []),
      ];
    }),
  ] : [], [room, local, localIdentity, peers, names, t]);
}

export function selectedMeetingStreams(streams: MeetingStream[], selection: string[] | null) {
  return selection === null ? streams : streams.filter((s) => selection.includes(s.key));
}

export async function showVideoMeeting(mode: "internal" | "system", streams: MeetingStream[]) {
  if (nativePipBusy()) return;
  const state = useVideoMeetingStore.getState();
  const selection = state.mode === "closed" ? null : state.selection;
  const selected = selectedMeetingStreams(streams, selection);
  if (!selected.length) return;
  if (mode === "system") {
    if (!await openNativeVideoPip(selected.map((s) => ({ sender: s.key, name: s.name })), state.focus ?? selected.find((s) => s.kind === "screen")?.key ?? null)) return;
  } else {
    // Le mode change avant l'événement de fermeture natif : cet événement
    // ne doit pas fermer à son tour la fenêtre interne qui prend le relais.
    useVideoMeetingStore.setState({ mode, selection, focus: state.mode === "closed" ? null : state.focus });
    await closeNativePip();
    return;
  }
  useVideoMeetingStore.setState({ mode, selection, focus: state.mode === "closed" ? null : state.focus });
}

export async function closeVideoMeeting() {
  if (nativePipBusy()) return;
  await closeNativePip();
  useVideoMeetingStore.setState({ mode: "closed", selection: null, focus: null });
}

export function toggleMeetingStream(key: string, streams: MeetingStream[]) {
  const state = useVideoMeetingStore.getState();
  const selection = selectedMeetingStreams(streams, state.selection).map((s) => s.key);
  const next = selection.includes(key) ? selection.filter((s) => s !== key) : [...selection, key];
  if (!next.length) return;
  useVideoMeetingStore.setState({ selection: next, focus: state.focus && next.includes(state.focus) ? state.focus : null });
}
