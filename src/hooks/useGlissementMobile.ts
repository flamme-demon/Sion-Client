import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useAppStore, type MobileView } from "../stores/useAppStore";
import { EVENEMENT_RETOUR_MOBILE, ouvertureMobile, superpositionMobileOuverte, vueApresGlissement, type RetourMobile } from "../services/navigationMobile";

/** Les déplacements modifient seulement la transformation CSS, pas le store du chat. */
export function useGlissementMobile() {
  const ref = useRef<HTMLDivElement>(null);
  const refMenu = useRef<HTMLElement>(null);
  const refChat = useRef<HTMLDivElement>(null);
  const refRetourChat = useRef<HTMLButtonElement>(null);
  const largeurRef = useRef(0);
  const vue = useAppStore((s) => s.mobileView);
  const [enGeste, setEnGeste] = useState(false);
  const geste = useRef<{ id: number; x: number; y: number; vue: MobileView; actif: boolean; distance: number; element: HTMLDivElement } | null>(null);
  const natif = useRef<{ x: number; vue: MobileView } | null>(null);
  const bloquerClicJusqua = useRef(0);
  const dessiner = useCallback((ouverture: number, anime: boolean) => {
    const element = ref.current;
    if (!element) return;
    const largeur = largeurRef.current || element.clientWidth;
    const x = Math.max(0, Math.min(largeur, ouverture));
    element.classList.toggle("sion-mobile-navigation--geste", !anime);
    // Une variable CSS héritée par tout le chat forçait le recalcul de
    // chaque message à chaque image. Seules ces deux couches se déplacent.
    if (refMenu.current) refMenu.current.style.transform = `translate3d(${x - largeur}px, 0, 0)`;
    if (refChat.current) refChat.current.style.transform = `translate3d(${x}px, 0, 0)`;
    if (refRetourChat.current) refRetourChat.current.style.transform = `translate3d(${x}px, 0, 0)`;
  }, []);
  const restaurer = useCallback(() => {
    setEnGeste(false);
    if (ref.current) dessiner(ouvertureMobile(useAppStore.getState().mobileView, ref.current.clientWidth), true);
  }, [dessiner]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const mesurer = () => {
      largeurRef.current = element.clientWidth;
      if (geste.current?.actif || natif.current) return;
      dessiner(ouvertureMobile(useAppStore.getState().mobileView, largeurRef.current), false);
      element.classList.remove("sion-mobile-navigation--geste");
    };
    mesurer();
    element.classList.remove("sion-mobile-navigation--geste");
    const observer = new ResizeObserver(mesurer);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dessiner]);
  useLayoutEffect(() => {
    if (ref.current) dessiner(ouvertureMobile(vue, ref.current.clientWidth), true);
  }, [vue, dessiner]);

  useEffect(() => {
    const retour = (event: Event) => {
      const detail = (event as CustomEvent<RetourMobile>).detail;
      const element = ref.current;
      if (!element) return;
      if (detail.phase === "start") {
        natif.current = { x: detail.touchX ?? 0, vue: useAppStore.getState().mobileView };
        setEnGeste(true);
      } else if (detail.phase === "progress" && natif.current) {
        const distance = Math.abs((detail.touchX ?? natif.current.x) - natif.current.x);
        dessiner(ouvertureMobile(natif.current.vue, element.clientWidth) + distance, false);
      } else if (detail.phase === "cancel" || detail.phase === "commit") {
        natif.current = null;
        restaurer();
      }
    };
    const annuler = () => {
      const g = geste.current;
      geste.current = null;
      if (g?.element.hasPointerCapture?.(g.id)) g.element.releasePointerCapture(g.id);
      natif.current = null;
      restaurer();
    };
    window.addEventListener(EVENEMENT_RETOUR_MOBILE, retour);
    window.addEventListener("blur", annuler);
    return () => {
      window.removeEventListener(EVENEMENT_RETOUR_MOBILE, retour);
      window.removeEventListener("blur", annuler);
    };
  }, [dessiner, restaurer]);

  const terminer = (annule: boolean) => {
    const g = geste.current;
    geste.current = null;
    if (g?.actif) bloquerClicJusqua.current = performance.now() + 250;
    if (g?.element.hasPointerCapture?.(g.id)) g.element.releasePointerCapture(g.id);
    if (g?.actif && !annule && ref.current) useAppStore.getState().setMobileView(vueApresGlissement(g.vue, g.distance, ref.current.clientWidth));
    restaurer();
  };
  return { ref, refMenu, refChat, refRetourChat, enGeste, gestes: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0 || superpositionMobileOuverte() || natif.current) return;
      const element = ref.current;
      if (!element) return;
      const x = event.clientX - element.getBoundingClientRect().left;
      // Le chat garde ses gestes sur les messages, les médias et le champ de saisie.
      if (vue === "chat" && x > 28) return;
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true], [data-overlay]")) return;
      geste.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vue, actif: false, distance: 0, element: event.currentTarget };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const g = geste.current;
      if (!g || g.id !== event.pointerId || !ref.current) return;
      const dx = event.clientX - g.x, dy = event.clientY - g.y;
      if (!g.actif) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { geste.current = null; return; }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        if (g.vue === "chat" && dx < 0) { geste.current = null; return; }
        g.element.setPointerCapture(event.pointerId);
        g.actif = true;
        setEnGeste(true);
        const focus = document.activeElement;
        if (focus instanceof HTMLElement && focus.matches("input, textarea, [contenteditable=true]")) focus.blur();
      }
      event.preventDefault();
      g.distance = dx;
      dessiner(ouvertureMobile(g.vue, ref.current.clientWidth) + dx, false);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => { if (geste.current?.id === event.pointerId) terminer(false); },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => { if (geste.current?.id === event.pointerId) terminer(true); },
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      // Le transfert de la capture implicite d'un enfant vers la navigation
      // déclenche aussi cet événement, qui remonte depuis l'enfant.
      if (event.target === event.currentTarget && geste.current?.id === event.pointerId) terminer(true);
    },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      // Le clic synthétique qui suit un glissement ne doit pas rejoindre un salon.
      if (performance.now() < bloquerClicJusqua.current) {
        event.preventDefault(); event.stopPropagation();
      }
    },
  } };
}
