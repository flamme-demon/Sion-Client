import { useBibliothequeActive } from "../../hooks/useBibliothequeActive";
/**
 * Lazy-loaded dock panels and titles shared by the desktop dock
 * and MobilePanelSheet.
 */
import { lazy, createElement, type ComponentType } from "react";
import { useLayoutStore, type PanneauId } from "../../stores/useLayoutStore";
import { useAppStore } from "../../stores/useAppStore";
import { estPanneauVisible } from "../../utils/panneauxVisibles";
export { PANNEAU_COMPTEURS } from "./panneauxCompteurs";

// Load heavy panels on demand. Soundboard, members and transcription
// should not bring their dependency subtrees into the initial app chunk.
const MemberPanel = lazy(() =>
  import("../chat/MemberPanel").then((m) => ({ default: m.MemberPanel })),
);
const SoundboardPanel = lazy(() =>
  import("../chat/SoundboardPanel").then((m) => ({ default: m.SoundboardPanel })),
);
const MemeboardPanel = lazy(() =>
  import("../chat/MemeboardPanel").then((m) => ({ default: m.MemeboardPanel })),
);
const PinnedPanel = lazy(() =>
  import("../chat/PinnedListPanel").then((m) => ({ default: m.PinnedListPanel })),
);
const TranscriptPanel = lazy(() =>
  import("../chat/TranscriptPanel").then((m) => ({ default: m.TranscriptPanel })),
);

export const PANNEAU_TITRES: Record<PanneauId, string> = {
  members: "members.title",
  soundboard: "soundboard.title",
  memeboard: "memeboard.title",
  transcript: "transcript.title",
  pinned: "chat.pinnedList",
};

export const PANNEAU_CORPS: Record<PanneauId, ComponentType> = {
  members: MemberPanel,
  soundboard: SoundboardEspace,
  memeboard: MemeboardEspace,
  transcript: TranscriptPanel,
  pinned: PinnedPanel,
};

export function fermerFeuilleMobile(): boolean {
  const courant = useLayoutStore.getState().panneau;
  if (!courant || !estPanneauVisible(courant, !!useAppStore.getState().connectedVoiceChannel)) return false;
  useLayoutStore.getState().fermerPanneau();
  return true;
}

function useCleBibliotheque() {
  return useBibliothequeActive().cle;
}
function SoundboardEspace() { return createElement(SoundboardPanel, { key: useCleBibliotheque() }); }
function MemeboardEspace() { return createElement(MemeboardPanel, { key: useCleBibliotheque() }); }
