import type { ChatMessage } from "../types/matrix";
import { useMatrixStore } from "../stores/useMatrixStore";
import { getRedactPowerLevel, getUserPowerLevel } from "./matrixService";
import { sessionSuppressions, sessionSuppressionActuelle } from "../stores/suppressionsMessages";

export function peutSupprimerMessage(salon: string, message: ChatMessage, utilisateur: string | null): boolean {
  return !!utilisateur && (message.senderId === utilisateur || getUserPowerLevel(salon) >= getRedactPowerLevel(salon));
}

/** Une suppression serveur par événement ; seuls les succès quittent le fil.
 * La session est vérifiée entre les requêtes et après chaque réponse. */
export async function supprimerMessages(salon: string, selection: readonly string[]) {
  const utilisateur = useMatrixStore.getState().currentUserId;
  const scope = sessionSuppressions();
  const supprimes: string[] = [], echecs: string[] = [];
  for (const id of new Set(selection)) {
    if (!utilisateur || !sessionSuppressionActuelle(scope) || useMatrixStore.getState().currentUserId !== utilisateur) return { supprimes, echecs, interrompu: true };
    const message = (useMatrixStore.getState().messages[salon] ?? []).find((m) => (m.eventId || String(m.id)) === id);
    if (!message) { echecs.push(id); continue; }
    if (!peutSupprimerMessage(salon, message, utilisateur)) { echecs.push(id); continue; }
    try {
      await useMatrixStore.getState().deleteMessage(salon, id);
      if (!sessionSuppressionActuelle(scope) || useMatrixStore.getState().currentUserId !== utilisateur) return { supprimes, echecs, interrompu: true };
      supprimes.push(id);
    } catch {
      echecs.push(id);
    }
  }
  return { supprimes, echecs, interrompu: false };
}
