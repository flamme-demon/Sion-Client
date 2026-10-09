import type { Channel } from "../types/matrix";
import { useAppStore } from "../stores/useAppStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { salonsDansEspace } from "../utils/espaces";
import { getMatrixClient, leaveRoom } from "./matrixService";
import { moteurRust } from "./moteur";

/** Départ volontaire : Matrix décide des droits, la liste locale suit le succès. */
export async function quitterSalon(salon: Channel) {
  const utilisateur = useMatrixStore.getState().currentUserId;
  const espaces = useEspacesStore.getState();
  espaces.initialiser(utilisateur);
  const dejaQuitte = useEspacesStore.getState().salonsQuittes.includes(salon.id);
  // Avant /leave : une mise à jour Matrix peut arriver avant sa réponse.
  if (!salon.isDM) espaces.marquerSalonQuitte(salon.id);
  try {
    await leaveRoom(salon.id);
  } catch (erreur) {
    if (!dejaQuitte && useEspacesStore.getState().utilisateur === utilisateur) espaces.oublierSalonQuitte(salon.id);
    throw erreur;
  }
  if (useMatrixStore.getState().currentUserId !== utilisateur) return;

  if (salon.isDM && !moteurRust()) {
    // Conserver le nettoyage m.direct du menu MP historique.
    const client = getMatrixClient();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contenu = client?.getAccountData("m.direct" as any)?.getContent() as Record<string, string[]> | undefined;
      const prochain: Record<string, string[]> = {};
      for (const [membre, salons] of Object.entries(contenu ?? {})) {
        const restants = salons.filter((id) => id !== salon.id);
        if (restants.length) prochain[membre] = restants;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client?.setAccountData("m.direct" as any, prochain as any);
    } catch { /* Le départ Matrix a réussi, même si m.direct attend le prochain sync. */ }
  }
  if (useMatrixStore.getState().currentUserId !== utilisateur) return;
  const restants = useMatrixStore.getState().channels.filter((c) => c.id !== salon.id);
  useMatrixStore.getState().setChannels(restants);
  const app = useAppStore.getState();
  if (app.pendingAutoJoinVoice === salon.id) app.setPendingAutoJoinVoice(null);
  if (app.activeChannel === salon.id) {
    const visibles = useSettingsStore.getState().sidebarView === "dm"
      ? restants.filter((c) => c.isDM && !c.isSpace && !c.isSoundboard)
      : salonsDansEspace(restants, useEspacesStore.getState().espaceActif);
    const prochain = visibles.find((c) => !c.hasVoice) ?? visibles[0];
    app.setActiveChannel(prochain?.id ?? "", prochain?.hasVoice ?? false);
  }
}
