import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { useLayoutStore, type PanneauId } from "../../stores/useLayoutStore";
import { placementSousPointeur, useApercuPlacementModule } from "./apercuPlacementModule";

/** Capture le pointeur : le geste reste actif au-dessus du chat et des vidéos,
 * sans passer par le glisser-déposer de fichiers de la fenêtre native. */
export function useDeplacementModule(id: PanneauId) {
  const geste = useRef<{ pointerId: number; x: number; y: number; actif: boolean; element: HTMLDivElement } | null>(null);
  const terminer = useCallback(() => {
    const courant = geste.current;
    if (!courant) return;
    geste.current = null;
    if (courant.element.hasPointerCapture?.(courant.pointerId)) courant.element.releasePointerCapture(courant.pointerId);
    courant.element.closest("[data-panneau]")?.classList.remove("sion-module-saisi");
    document.body.classList.remove("layout-deplacement-module");
    useApercuPlacementModule.getState().liberer();
    if (useLayoutStore.getState().panneauEnDeplacement === id) useLayoutStore.getState().commencerDeplacement(null);
  }, [id]);

  useEffect(() => {
    const echapper = (event: KeyboardEvent) => {
      if (event.key === "Escape" && geste.current) {
        event.preventDefault();
        event.stopPropagation();
        terminer();
      }
    };
    window.addEventListener("keydown", echapper, true);
    window.addEventListener("blur", terminer);
    return () => {
      window.removeEventListener("keydown", echapper, true);
      window.removeEventListener("blur", terminer);
      terminer();
    };
  }, [terminer]);

  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || geste.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      geste.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, actif: false, element: event.currentTarget };
      document.body.classList.add("layout-deplacement-module");
      event.currentTarget.closest("[data-panneau]")?.classList.add("sion-module-saisi");
      useApercuPlacementModule.getState().saisir(id, event.clientX, event.clientY);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const courant = geste.current;
      if (!courant || courant.pointerId !== event.pointerId) return;
      useApercuPlacementModule.getState().suivre(event.clientX, event.clientY);
      if (!courant.actif) {
        if (Math.hypot(event.clientX - courant.x, event.clientY - courant.y) < 5) return;
        courant.actif = true;
        useLayoutStore.getState().commencerDeplacement(id);
      }
      useApercuPlacementModule.getState().viser(placementSousPointeur(courant.element, id, event.clientX, event.clientY));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const courant = geste.current;
      if (!courant || courant.pointerId !== event.pointerId) return;
      const cible = courant.actif ? placementSousPointeur(courant.element, id, event.clientX, event.clientY) : null;
      terminer();
      if (cible) useLayoutStore.getState().deplacerPanneau(id, cible.zone, cible.avant);
    },
    onPointerCancel: terminer,
    onLostPointerCapture: terminer,
  };
}
