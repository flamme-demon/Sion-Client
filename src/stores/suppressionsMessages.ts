import type { ChatMessage } from "../types/matrix";

function nouvelleSession() {
  return { confirmed: new Map<string, Set<string>>(), pending: new Map<string, Promise<void>>() };
}
let session = nouvelleSession();
export const sessionSuppressions = (): object => session;
export const sessionSuppressionActuelle = (scope: object): boolean => scope === session;
export function reinitialiserSuppressions(): void { session = nouvelleSession(); }
export const suppressionConfirmee = (salon: string, id: string): boolean => session.confirmed.get(salon)?.has(id) ?? false;

/** Keep successful redactions hidden while old snapshots are still in flight. */
export function noterSuppression(salon: string, id: string, scope: object): void {
  if (!sessionSuppressionActuelle(scope)) return;
  const ids = session.confirmed.get(salon) ?? new Set<string>();
  ids.add(id);
  // Twice the displayed window is enough to cover delayed snapshots.
  if (ids.size > 1000) ids.delete(ids.values().next().value!);
  session.confirmed.set(salon, ids);
}
export function filtrerSuppressions(salon: string, messages: ChatMessage[]): ChatMessage[] {
  const ids = session.confirmed.get(salon);
  return ids?.size ? messages.filter((m) => !ids.has(String(m.id)) && (!m.eventId || !ids.has(m.eventId))) : messages;
}
export function supprimerUneFois(salon: string, id: string, action: (scope: object) => Promise<void>): Promise<void> {
  const scope = session;
  const key = JSON.stringify([salon, id]);
  const previous = scope.pending.get(key);
  if (previous) return previous;
  const pending = Promise.resolve().then(() => {
    if (sessionSuppressionActuelle(scope)) return action(scope);
  }).finally(() => scope.pending.delete(key));
  scope.pending.set(key, pending);
  return pending;
}
