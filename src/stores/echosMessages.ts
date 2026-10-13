import type { ChatMessage } from "../types/matrix";

/** Un fil complet peut arriver avant l'accusé HTTP, ou entre deux envois.
 *  Seuls les échos encore absents du fil sont gardés ; jamais de comparaison
 *  par texte, car deux messages identiques peuvent être envoyés de suite. */
export function fusionnerEchos(avant: ChatMessage[], fil: ChatMessage[]): ChatMessage[] {
  const ids = new Set(fil.map((m) => m.eventId ?? m.id));
  const transactions = new Set(fil.filter((m) => m.transactionId).map((m) => `${m.senderId}/${m.transactionId}`));
  const echos = avant.filter((m) => m.localEcho
    && !ids.has(m.eventId ?? m.id)
    && !(m.transactionId && transactions.has(`${m.senderId}/${m.transactionId}`)));
  return echos.length ? [...fil, ...echos] : fil;
}

/** L'accusé fournit un vrai ID : le message reste visible sans attendre la
 *  synchro. Si elle l'a déjà remplacé, on conserve son contenu serveur. */
export function confirmerEcho(messages: ChatMessage[], transaction: string, eventId: string): ChatMessage[] {
  const echo = messages.find((m) => m.localEcho && m.transactionId === transaction);
  if (!echo) return messages;
  if (messages.some((m) => !m.localEcho && m.eventId === eventId)) {
    return messages.filter((m) => m !== echo);
  }
  return messages.map((m) => m === echo ? { ...m, id: eventId, eventId, sending: false } : m);
}
