import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../stores/useAppStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { contexteBibliotheque } from "../utils/bibliotheque";

export function useBibliothequeActive() {
  const espace = useEspacesStore((s) => s.espaceActif);
  const hierarchies = useEspacesStore((s) => s.hierarchies);
  const conserve = useEspacesStore((s) => s.espaceVocalConserve);
  const vocal = useAppStore((s) => s.connectedVoiceChannel);
  // Les changements de présence et de parole ne doivent pas repeindre les
  // cartes. Ne s'abonner qu'au contexte résolu et à son identité de compte.
  return useMatrixStore(useShallow(({ channels, currentUserId: compte }) => {
    const contexte = contexteBibliotheque(channels, espace, vocal, hierarchies, conserve);
    const parent = channels.find((c) => c.id === contexte.espaceId)
      ?? (conserve?.espace.id === contexte.espaceId ? conserve.espace : undefined);
    return { ...contexte, espaceNom: parent?.name, vocalNom: channels.find((c) => c.id === vocal)?.name,
      cle: `${compte}:${contexte.indisponible ? `attente:${vocal}` : contexte.espaceId ?? "serveur"}:${parent?.boardRoomId ?? ""}` };
  }));
}
