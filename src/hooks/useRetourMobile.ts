import { useEffect, useRef, useState } from "react";
import { useAppStore, type MobileView } from "../stores/useAppStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { fermerFeuilleMobile } from "../components/layout/panneaux";
import { EVENEMENT_RETOUR_MOBILE, superpositionMobileOuverte, vueApresRetour, type RetourMobile } from "../services/navigationMobile";
import { fermerMenuContextuel } from "../utils/menuContextuel";

/** Un seul chemin pour le bouton Retour, le geste prédictif et la fermeture de l'app. */
export function useRetourMobile(actif: boolean, quitterVocal: (salon: string) => Promise<void>) {
  const [backToast, setBackToast] = useState(false);
  const quitterRef = useRef(quitterVocal);
  useEffect(() => { quitterRef.current = quitterVocal; }, [quitterVocal]);
  useEffect(() => {
    if (!actif) return;
    let detruit = false;
    let veutQuitter = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: { unregister: () => Promise<void> } | undefined;
    let geste: { x: number; distance: number; vue: MobileView } | null = null;
    const avertir = (event: RetourMobile) => window.dispatchEvent(new CustomEvent(EVENEMENT_RETOUR_MOBILE, { detail: event }));
    const resetQuitter = () => { veutQuitter = false; clearTimeout(timer); setBackToast(false); };
    const revenir = (destination?: MobileView) => {
      const s = useAppStore.getState();
      if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
      if (fermerMenuContextuel()) return;
      if (s.userContextMenu) { s.closeUserContextMenu(); return; }
      if (useEspacesStore.getState().fenetre) { useEspacesStore.getState().ouvrir(null); return; }
      if (s.showAccountPanel) { s.toggleAccountPanel(); return; }
      if (s.showSettings) { s.toggleSettings(); return; }
      if (s.showAdmin) { s.toggleAdmin(); return; }
      if (fermerFeuilleMobile()) return;
      if (s.mobileView !== "sidebar") {
        resetQuitter();
        s.setMobileView(destination ?? vueApresRetour(s.mobileView));
        return;
      }
      if (veutQuitter) {
        resetQuitter();
        const fermer = () => import("@tauri-apps/api/core").then(({ invoke }) => invoke("exit_app"));
        if (s.connectedVoiceChannel) void quitterRef.current(s.connectedVoiceChannel).finally(fermer);
        else void fermer();
        return;
      }
      veutQuitter = true;
      setBackToast(true);
      timer = setTimeout(resetQuitter, 2500);
    };
    const natif = (event: RetourMobile) => {
      if (detruit) return false;
      if (event.phase === "start") {
        geste = superpositionMobileOuverte() ? null : { x: event.touchX ?? 0, distance: 0, vue: useAppStore.getState().mobileView };
        if (geste) avertir(event);
      } else if (event.phase === "progress" && geste) {
        if (superpositionMobileOuverte()) { geste = null; avertir({ phase: "cancel" }); }
        else {
          geste.distance = Math.abs((event.touchX ?? geste.x) - geste.x);
          avertir(event);
        }
      } else if (event.phase === "cancel") {
        geste = null; avertir(event);
      } else if (event.phase === "commit") {
        const largeur = document.querySelector<HTMLElement>(".sion-mobile-navigation")?.clientWidth ?? window.innerWidth;
        const destination = geste && geste.vue === useAppStore.getState().mobileView
          ? vueApresRetour(geste.vue, geste.distance, largeur) : undefined;
        geste = null;
        revenir(destination);
        avertir(event);
      }
      return true;
    };
    window.__SION_MOBILE_BACK__ = natif;
    // Le pont natif s'inscrit après Tauri, afin de recevoir aussi la progression.
    void import("@tauri-apps/api/app").then(async ({ onBackButtonPress }) => {
      const inscrit = await onBackButtonPress(() => { revenir(); avertir({ phase: "commit" }); });
      if (detruit) { await inscrit.unregister(); return; }
      listener = inscrit;
      window.__SION_NAVIGATION__?.setEnabled(true);
    }).catch(() => { /* Le glissement reste disponible dans un navigateur. */ });
    return () => {
      detruit = true;
      clearTimeout(timer);
      if (window.__SION_MOBILE_BACK__ === natif) delete window.__SION_MOBILE_BACK__;
      window.__SION_NAVIGATION__?.setEnabled(false);
      void listener?.unregister();
    };
  }, [actif]);
  return backToast;
}
