import type { Channel } from "../types/matrix";

export function adresseEspace(entree: string): { adresse: string; via: string[] } {
  const texte = entree.trim();
  let adresse = texte;
  let via: string[] = [];
  if (texte.startsWith("https://matrix.to/")) {
    const u = new URL(texte);
    const partie = u.hash.replace(/^#\//, "");
    const index = partie.indexOf("?");
    adresse = decodeURIComponent(index < 0 ? partie : partie.slice(0, index));
    via = new URLSearchParams(index < 0 ? "" : partie.slice(index + 1)).getAll("via");
  } else if (texte.startsWith("matrix:")) {
    const u = new URL(texte);
    const morceaux = u.pathname.split("/");
    adresse = `${morceaux[0] === "r" ? "#" : "!"}${decodeURIComponent(morceaux[1] || "")}`;
    via = u.searchParams.getAll("via");
  }
  if (!/^[!#][^\s/?]+$/.test(adresse) || (adresse.startsWith("#") && !adresse.includes(":"))) {
    throw new Error("spaces.invalidAddress");
  }
  if (via.some((s) => !s || /[\s/?#@]/.test(s))) throw new Error("spaces.invalidAddress");
  return { adresse, via: [...new Set(via)] };
}

export function salonCommun(regle: Record<string, unknown> | undefined, espace: string): boolean {
  if (regle?.join_rule === "public") return true;
  return ["restricted", "knock_restricted"].includes(String(regle?.join_rule))
    && Array.isArray(regle?.allow)
    && regle.allow.some((a) => a?.type === "m.room_membership" && a.room_id === espace);
}

/** Sans Espace sélectionné, seuls les salons non rattachés restent dans l'accueil serveur. */
export function salonsDansEspace(channels: Channel[], espace: string | null, hierarchies: Record<string, string[]> = {}): Channel[] {
  const espaces = new Map(channels.filter((c) => c.isSpace).map((c) => [c.id, c.spaceChildren ?? []]));
  const enfants = new Set<string>();
  const visites = new Set<string>();
  const pile = espace ? [espace] : [...espaces.keys()];
  while (pile.length) {
    const id = pile.pop()!;
    if (visites.has(id)) continue;
    visites.add(id);
    for (const enfant of espaces.get(id) ?? hierarchies[id] ?? []) {
      enfants.add(enfant);
      if (espaces.has(enfant) || hierarchies[enfant]) pile.push(enfant);
    }
  }
  return channels.filter((c) => !c.isSpace && !c.isDM && !c.isSoundboard
    && c.membership !== "invite" && (espace ? enfants.has(c.id) : !enfants.has(c.id)));
}
