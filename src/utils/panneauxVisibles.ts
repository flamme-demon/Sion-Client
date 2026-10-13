import type { PanneauId } from "../stores/useLayoutStore";

export function estPanneauVisible(id: PanneauId, connecteAuVocal: boolean): boolean {
  return connecteAuVocal || (id !== "soundboard" && id !== "memeboard");
}
