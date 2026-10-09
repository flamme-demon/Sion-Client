import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
/**
 * Panneaux de la dock : composants (chargés à la demande) et titres. Partagés
 * par la dock du bureau et la feuille du téléphone (`MobilePanelSheet`).
 */
import { lazy, createElement, type ComponentType } from "react";
import { useLayoutStore, type PanneauId } from "../../stores/useLayoutStore";
export { PANNEAU_COMPTEURS } from "./panneauxCompteurs";

// Blocs lourds chargés à la demande (perf mémoire, 2026-09-12) : le soundboard
// embarquait dans le chunk de démarrage tout son sous-graphe (panneau vocal,
// modal d'upload, trimballeur, hotkeys) alors qu'il n'est peint que si le
// bloc est docké ET le salon soundboard présent. Idem membres et
// transcription. Le chunk de boot ne garde que la coquille de la dock.
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

/** Panneau actif, partagé avec le retour d'Android. */
export function panneauxOuverts(): PanneauId[] {
  return useLayoutStore.getState().panneaux;
}

export function fermerFeuilleMobile(): boolean {
  if (!useLayoutStore.getState().panneau) return false;
  useLayoutStore.getState().fermerPanneau();
  return true;
}

function useCleBibliotheque() {
  const espace = useEspacesStore((s) => s.espaceActif);
  const board = useMatrixStore((s) => s.channels.find((c) => c.id === espace)?.boardRoomId);
  return `${espace ?? "serveur"}:${board ?? ""}`;
}
function SoundboardEspace() { return createElement(SoundboardPanel, { key: useCleBibliotheque() }); }
function MemeboardEspace() { return createElement(MemeboardPanel, { key: useCleBibliotheque() }); }
