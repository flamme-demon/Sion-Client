import type { MobileView } from "../stores/useAppStore";
import { useAppStore } from "../stores/useAppStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { useLayoutStore } from "../stores/useLayoutStore";

export const LARGEUR_ESPACES_MOBILE = 68;
export const EVENEMENT_RETOUR_MOBILE = "sion-retour-mobile";

export type RetourMobile = {
  phase: "start" | "progress" | "cancel" | "commit";
  touchX?: number;
  progress?: number;
};

export function ouvertureMobile(vue: MobileView, largeur: number) {
  return vue === "chat" ? 0 : vue === "channels" ? Math.max(0, largeur - LARGEUR_ESPACES_MOBILE) : largeur;
}

/** Le premier palier laisse le chat visible ; poursuivre révèle les espaces. */
export function vueApresGlissement(vue: MobileView, distance: number, largeur: number): MobileView {
  if (largeur <= 0 || Math.abs(distance) < 16) return vue;
  if (vue === "chat") {
    if (distance > largeur * .78) return "sidebar";
    return distance > largeur * .14 ? "channels" : "chat";
  }
  if (vue === "channels") {
    if (distance > LARGEUR_ESPACES_MOBILE * .45) return "sidebar";
    return distance < -largeur * .14 ? "chat" : "channels";
  }
  if (distance < -largeur * .45) return "chat";
  return distance < -LARGEUR_ESPACES_MOBILE * .45 ? "channels" : "sidebar";
}

/** Un retour validé ouvre toujours un palier, même avec un geste système court. */
export function vueApresRetour(vue: MobileView, distance = 0, largeur = 0): MobileView {
  if (vue === "chat") return largeur > 0 && distance > largeur * .78 ? "sidebar" : "channels";
  return "sidebar";
}

export function superpositionMobileOuverte() {
  const s = useAppStore.getState();
  return !!(document.fullscreenElement || s.showAccountPanel || s.showSettings || s.showAdmin
    || s.userContextMenu || useLayoutStore.getState().panneau || useEspacesStore.getState().fenetre
    || document.querySelector("[data-menu-contextuel]"));
}

declare global {
  interface Window {
    __SION_MOBILE_BACK__?: (event: RetourMobile) => boolean;
    __SION_NAVIGATION__?: { setEnabled: (enabled: boolean) => void };
  }
}
