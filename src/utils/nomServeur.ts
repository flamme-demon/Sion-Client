/** Libellé du serveur connecté, utilisé dans la navigation et les salons. */
export function nomServeur(url?: string): string {
  if (!url) return "Sion";
  try { return new URL(url).hostname; }
  catch { return url; }
}
