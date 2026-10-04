/** Heure affichée d'un message (« 14:05 »). Un seul formateur pour toute
 *  l'appli : `toLocaleTimeString` avec options en recrée un à chaque appel,
 *  et le cœur republie des fils entiers (480 messages pour le salon
 *  d'administration) à chaque changement — c'était l'une des fonctions les
 *  plus vues du profil de l'interface au repos (04/10). */
const FORMAT_HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function heureMessage(ts: number): string {
  return FORMAT_HEURE.format(new Date(ts));
}
