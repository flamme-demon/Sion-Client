import { useMemo } from "react";
import { useAppStore } from "../stores/useAppStore";
import { useLayoutStore } from "../stores/useLayoutStore";
import { estPanneauVisible } from "../utils/panneauxVisibles";

export function usePanneauxVisibles() {
  const panneaux = useLayoutStore((s) => s.panneaux);
  const connecteAuVocal = useAppStore((s) => !!s.connectedVoiceChannel);
  return useMemo(() => connecteAuVocal ? panneaux : panneaux.filter((id) => estPanneauVisible(id, false)), [panneaux, connecteAuVocal]);
}
