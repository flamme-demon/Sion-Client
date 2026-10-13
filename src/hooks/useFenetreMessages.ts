import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types/matrix";

const PAGE = 60;
const id = (message: ChatMessage) => message.eventId || String(message.id);

/** Un retour au salon ne remonte pas tout son historique en DOM. Les pages
 * déjà en mémoire apparaissent en remontant, avant toute pagination réseau. */
export function useFenetreMessages(salon: string, messages: readonly ChatMessage[], cible: number,
  container: () => HTMLDivElement | null) {
  const initial = Math.max(0, Math.min(messages.length - PAGE, cible >= 0 ? cible - 1 : messages.length));
  const [fenetre, setFenetre] = useState({ salon, premier: messages[initial] ? id(messages[initial]) : null, depuisDebut: initial === 0 });
  const courant = fenetre.salon === salon && fenetre.premier ? messages.findIndex(m => id(m) === fenetre.premier) : -1;
  const debut = courant >= 0 ? fenetre.depuisDebut ? 0 : Math.min(courant, cible >= 0 ? Math.max(0, cible - 1) : courant) : initial;
  // Conserver une identité plutôt qu'un nombre : un nouveau message ou une
  // page reçue en tête ne doit pas décaler la vue que quelqu'un est en train de lire.
  const premier = messages[debut] ? id(messages[debut]) : null;
  if (fenetre.salon !== salon || fenetre.premier !== premier) setFenetre({ salon, premier, depuisDebut: debut === 0 });
  const ancre = useRef<{ salon: string; hauteur: number; haut: number } | null>(null);
  const afficherPlus = useCallback(() => {
    const el = container();
    if (!el || debut === 0) return;
    ancre.current = { salon, hauteur: el.scrollHeight, haut: el.scrollTop };
    const prochainIndex = Math.max(0, debut - PAGE);
    setFenetre({ salon, premier: id(messages[prochainIndex]), depuisDebut: prochainIndex === 0 });
  }, [salon, messages, debut, container]);
  useLayoutEffect(() => {
    const avant = ancre.current;
    ancre.current = null;
    const el = container();
    if (avant?.salon === salon && el) el.scrollTop = avant.haut + el.scrollHeight - avant.hauteur;
  }, [salon, debut, container]);
  return { debut, afficherPlus };
}
