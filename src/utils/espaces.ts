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
export function salonsDansEspace(channels: Channel[], espace: string | null): Channel[] {
  const enfants = espace
    ? new Set(channels.find((c) => c.id === espace && c.isSpace)?.spaceChildren ?? [])
    : new Set(channels.filter((c) => c.isSpace).flatMap((c) => c.spaceChildren ?? []));
  return channels.filter((c) => !c.isSpace && !c.isDM && !c.isSoundboard
    && c.membership !== "invite" && (espace ? enfants.has(c.id) : !enfants.has(c.id)));
}
