import type { Channel } from "../types/matrix";

export type TypeSalonServeur = "espaces" | "salons" | "mp" | "bibliotheques" | "autres";
export interface InfoSalonServeur {
  id: string;
  name?: string;
  roomType?: string;
}
export interface SalonServeur extends InfoSalonServeur {
  type: TypeSalonServeur;
  hasVoice: boolean;
  espaceIds: string[];
  espaceNoms: string[];
}

/** L'API peut fournir des IDs seuls ou des entrées avec leurs métadonnées. */
export function lireListeSalonsServeur(reponse: unknown): InfoSalonServeur[] {
  if (!reponse || typeof reponse !== "object" || !("rooms" in reponse) || !Array.isArray(reponse.rooms)) {
    throw new Error("admin.actions.roomsLoadFailed");
  }
  const salons = new Map<string, InfoSalonServeur>();
  for (const valeur of reponse.rooms) {
    if (typeof valeur === "string") {
      if (valeur.startsWith("!")) salons.set(valeur, { id: valeur });
    } else if (valeur && typeof valeur === "object") {
      const id = valeur.room_id ?? valeur.id;
      if (typeof id !== "string" || !id.startsWith("!")) continue;
      salons.set(id, { id,
        name: typeof valeur.name === "string" && valeur.name.trim() ? valeur.name : undefined,
        roomType: typeof valeur.room_type === "string" ? valeur.room_type : undefined,
      });
    }
  }
  return [...salons.values()];
}

/** Les MP se reconnaissent via le compte, jamais par leur nombre de membres. */
export function classerSalonsServeur(liste: InfoSalonServeur[], channels: Channel[], informations: InfoSalonServeur[] = [],
  directs: Set<string> = new Set(), salonAdmin: string | null = null): SalonServeur[] {
  const connus = new Map(channels.map((c) => [c.id, c]));
  const infos = new Map(informations.map((r) => [r.id, r]));
  const espaces = channels.filter((c) => c.isSpace);
  const bibliotheques = new Set(espaces.flatMap((c) => c.boardRoomId ? [c.boardRoomId] : []));
  return liste.filter((r) => r.id !== salonAdmin).map((r) => {
    const ch = connus.get(r.id), info = infos.get(r.id);
    const roomType = info?.roomType ?? r.roomType;
    const type: TypeSalonServeur = ch?.isSpace || roomType === "m.space" ? "espaces"
      : ch?.isSoundboard || bibliotheques.has(r.id) || roomType === "com.sion.board" ? "bibliotheques"
      : ch?.isDM || directs.has(r.id) ? "mp"
      : ch || info || r.name || roomType ? "salons" : "autres";
    const parents = espaces.filter((e) => e.spaceChildren?.includes(r.id) || e.boardRoomId === r.id);
    return { ...r, name: ch?.name || info?.name || r.name, roomType, type,
      hasVoice: ch?.hasVoice ?? roomType === "m.voice_channel",
      espaceIds: parents.map((e) => e.id), espaceNoms: parents.map((e) => e.name),
    };
  }).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}
