import type { Channel } from "../types/matrix";

export interface SalonDepart {
  salon: Channel;
  partageAvec: Channel[];
}

/** Adhésions à quitter, descendants avant leurs parents. Les relations
 * actuelles des espaces rejoints priment sur le catalogue de découverte. */
export function planDepartEspace(channels: Channel[], espaceId: string,
  hierarchies: Record<string, string[]> = {}): SalonDepart[] {
  const rejoints = channels.filter((c) => c.membership !== "invite");
  const parId = new Map(rejoints.map((c) => [c.id, c]));
  const liens = new Map(Object.entries(hierarchies));
  for (const c of rejoints.filter((c) => c.isSpace)) {
    liens.set(c.id, [...new Set([...(c.spaceChildren ?? []), ...(c.boardRoomId ? [c.boardRoomId] : [])])]);
  }
  const descendants = (racine: string) => {
    const visites = new Set<string>();
    const ordre: string[] = [];
    const visiter = (id: string) => {
      if (visites.has(id)) return;
      visites.add(id);
      for (const enfant of liens.get(id) ?? []) visiter(enfant);
      ordre.push(id);
    };
    visiter(racine);
    return ordre;
  };
  const ordre = descendants(espaceId).filter((id) => id !== espaceId);
  const candidats = new Set(ordre);
  // Un sous-espace descendant exclusif ne rend pas ses propres salons
  // "partagés". Seuls les espaces que l'on garde protègent leurs enfants.
  const autres = rejoints.filter((c) => c.isSpace && c.id !== espaceId && !candidats.has(c.id))
    .map((espace) => ({ espace, enfants: new Set(descendants(espace.id)) }));
  return ordre.flatMap((id) => {
    const salon = parId.get(id);
    if (!salon || salon.isDM) return [];
    return [{ salon, partageAvec: autres.filter((a) => a.enfants.has(id)).map((a) => a.espace) }];
  });
}
