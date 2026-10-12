import { useEffect } from "react";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useAppStore } from "../stores/useAppStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { salonsDansEspace } from "../utils/espaces";
import { useSettingsStore } from "../stores/useSettingsStore";

/** Synchronisation légère : aucun abonnement aux messages ni aux frappes. */
export function useEspaces() {
  const utilisateur = useMatrixStore((s) => s.currentUserId);
  useEffect(() => {
    useEspacesStore.getState().initialiser(utilisateur);
  }, [utilisateur]);
}

export function choisirEspace(espace: string | null) {
  const channels = useMatrixStore.getState().channels;
  const actuel = useAppStore.getState().activeChannel;
  const avant = useEspacesStore.getState().espaceActif;
  const hierarchies = useEspacesStore.getState().hierarchies;
  if (actuel && salonsDansEspace(channels, avant, hierarchies).some((c) => c.id === actuel)) useEspacesStore.getState().memoriserSalon(avant, actuel);
  useEspacesStore.getState().choisir(espace);
  useSettingsStore.getState().setSidebarView("channels");
  const visibles = salonsDansEspace(channels, espace, hierarchies);
  const dernier = useEspacesStore.getState().derniersSalons[espace ?? "serveur"];
  const prochain = visibles.find((c) => c.id === dernier) ?? visibles.find((c) => !c.hasVoice) ?? visibles[0];
  useAppStore.getState().setActiveChannel(prochain?.id ?? "", prochain?.hasVoice ?? false);
}
