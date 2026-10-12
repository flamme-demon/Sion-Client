import { lienEspace } from "./espacesService";

export type ResultatPartage = "partage" | "copie" | "annule";

declare global {
  interface Window {
    __SION_PARTAGE__?: { partagerLien: (titre: string, lien: string) => boolean };
  }
}

/** Appelé directement depuis le clic pour conserver l'activation du partage système. */
export async function partagerInvitation(espace: string, titre: string, mobile: boolean): Promise<ResultatPartage> {
  const url = lienEspace(espace);
  if (window.__SION_PARTAGE__?.partagerLien(titre, url)) return "partage";
  if (mobile && navigator.share) {
    try {
      await navigator.share({ title: titre, url });
      return "partage";
    } catch (erreur) {
      if (erreur && typeof erreur === "object" && "name" in erreur && erreur.name === "AbortError") return "annule";
      throw erreur;
    }
  }
  await navigator.clipboard.writeText(url);
  return "copie";
}
