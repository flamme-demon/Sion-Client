import { useEffect, useRef } from "react";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useAppStore } from "../stores/useAppStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { salonsDansEspace } from "../utils/espaces";
import { rejoindreSalonsCommuns } from "../services/espacesService";
import { useSettingsStore } from "../stores/useSettingsStore";

/** Synchronisation légère : aucun abonnement aux messages ni aux frappes. */
export function useEspaces() {
  const utilisateur = useMatrixStore((s) => s.currentUserId);
  const channels = useMatrixStore((s) => s.channels);
  const connecte = useMatrixStore((s) => s.connectionStatus === "connected");
  const espace = useEspacesStore((s) => s.espaceActif);
  const tentatives = useRef(new Map<string, string>());
  useEffect(() => {
    useEspacesStore.getState().initialiser(utilisateur);
    tentatives.current.clear();
  }, [utilisateur]);
  useEffect(() => {
    if (!connecte) return;
    const ch = channels.find((c) => c.id === espace && c.isSpace && c.membership !== "invite");
    if (!ch) return;
    const signature = [...(ch.spaceChildren ?? [])].sort().join("\n");
    if (tentatives.current.get(ch.id) === signature) return;
    tentatives.current.set(ch.id, signature);
    let actif = true;
    void rejoindreSalonsCommuns(ch.id).then((echecs) => {
      if (actif && echecs.length) console.warn("[Sion][espaces] salons à rejoindre manuellement", echecs);
    }).catch((e) => {
      if (useMatrixStore.getState().currentUserId === utilisateur && tentatives.current.get(ch.id) === signature) tentatives.current.delete(ch.id);
      if (actif) console.warn("[Sion][espaces] hiérarchie indisponible", e);
    });
    return () => { actif = false; };
  }, [connecte, channels, espace, utilisateur]);
}

export function choisirEspace(espace: string | null) {
  const channels = useMatrixStore.getState().channels;
  const actuel = useAppStore.getState().activeChannel;
  const avant = useEspacesStore.getState().espaceActif;
  if (actuel && salonsDansEspace(channels, avant).some((c) => c.id === actuel)) useEspacesStore.getState().memoriserSalon(avant, actuel);
  useEspacesStore.getState().choisir(espace);
  useSettingsStore.getState().setSidebarView("channels");
  const visibles = salonsDansEspace(channels, espace);
  const dernier = useEspacesStore.getState().derniersSalons[espace ?? "serveur"];
  const prochain = visibles.find((c) => c.id === dernier) ?? visibles.find((c) => !c.hasVoice) ?? visibles[0];
  useAppStore.getState().setActiveChannel(prochain?.id ?? "", prochain?.hasVoice ?? false);
}
