import { useEffect } from "react";
import { create } from "zustand";
import { onVoiceNativePip, pipNativeClose, pipNativeOpen, pipNativeSources, pipNativeOpenStreams, type NativePipStream } from "../services/voiceNativeService";

// Une fenêtre système et un abonnement partagés par les webcams et les
// partages. Aucune donnée vidéo ne transite par ce store.
const usePipState = create<{ sender: string | null; sources: string[]; busy: boolean; error: boolean }>(() => ({ sender: null, sources: [], busy: false, error: false }));
let watchers = 0;
let generation = 0;
let revision = 0;
let unlisten: (() => void) | null = null;

export function nativePipBusy() { return usePipState.getState().busy; }

function watch() {
  if (watchers++ === 0) {
    const session = ++generation;
    void onVoiceNativePip((event) => {
      if (session !== generation) return;
      revision++;
      usePipState.setState({ sender: event.open ? event.sender ?? null : null, sources: event.open ? event.sources ?? (event.sender ? [event.sender] : []) : [] });
    }).then(async (stop) => {
      if (session !== generation) { stop(); return; }
      unlisten = stop;
      const before = revision;
      const sources = await pipNativeSources();
      if (session === generation && revision === before) usePipState.setState({ sender: sources[0] ?? null, sources });
    }).catch(() => {});
  }
  return () => {
    if (--watchers === 0) { generation++; unlisten?.(); unlisten = null; }
  };
}

export async function openNativePip(sender: string): Promise<boolean> {
  if (usePipState.getState().busy) return false;
  usePipState.setState({ busy: true, error: false });
  const before = revision;
  try {
    const opened = await pipNativeOpen(sender);
    if (opened && revision === before) usePipState.setState({ sender, sources: [sender] });
    usePipState.setState({ error: !opened });
    return opened;
  } finally { usePipState.setState({ busy: false }); }
}

export async function openNativeVideoPip(streams: NativePipStream[], focus: string | null): Promise<boolean> {
  if (usePipState.getState().busy || !streams.length) return false;
  usePipState.setState({ busy: true, error: false });
  const before = revision;
  try {
    const opened = await pipNativeOpenStreams(streams, focus);
    if (opened && revision === before) usePipState.setState({ sender: focus ?? streams[0].sender, sources: streams.map((s) => s.sender) });
    usePipState.setState({ error: !opened });
    return opened;
  } finally { usePipState.setState({ busy: false }); }
}

export async function closeNativePip(): Promise<void> {
  if (usePipState.getState().busy) return;
  usePipState.setState({ busy: true });
  try { await pipNativeClose(); usePipState.setState({ sender: null, sources: [], error: false }); }
  finally { usePipState.setState({ busy: false }); }
}

export function useNativePip() {
  useEffect(watch, []);
  return usePipState();
}
