import type { Channel } from "../types/matrix";
import { salonsDansEspace } from "./espaces";

export interface EspaceVocalConserve { vocal: string; espace: Channel }

/** La navigation reste libre pendant un appel. Les boards, elles, suivent
 * l'espace du vocal pour ne pas changer la bibliothèque diffusée aux pairs. */
export function contexteBibliotheque(channels: Channel[], espaceConsulte: string | null,
  vocal: string | null, hierarchies: Record<string, string[]> = {}, conserve?: EspaceVocalConserve | null) {
  if (!vocal) return { espaceId: espaceConsulte, vocalId: null, indisponible: false };
  if (conserve?.vocal === vocal && !channels.some((c) => c.id === conserve.espace.id)) {
    channels = [...channels, conserve.espace];
  }
  const salon = channels.find((c) => c.id === vocal && c.membership !== "invite");
  // Attendre la synchronisation plutôt que choisir la bibliothèque d'une
  // autre équipe (ou celle du serveur) pour un vocal encore inconnu.
  if (!salon || salon.isDM) return { espaceId: null, vocalId: vocal, indisponible: true };
  const parents = channels.filter((c) => c.isSpace && c.membership !== "invite"
    && salonsDansEspace(channels, c.id, hierarchies).some((s) => s.id === vocal));
  // Préférer un espace avec bibliothèque, puis un parent direct. Les liens
  // multiples restent stables même quand on navigue dans un autre espace.
  const score = (c: Channel) => (c.boardRoomId ? 0 : 2) + (c.spaceChildren?.includes(vocal) ? 0 : 1);
  parents.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
  return { espaceId: parents[0]?.id ?? null, vocalId: vocal, indisponible: false };
}
