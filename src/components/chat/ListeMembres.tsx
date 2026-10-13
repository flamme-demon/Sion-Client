import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const MARGE = 4;
const SEUIL = 40;

/** Ne monte que les membres proches de la vue. Le défilement reste celui du
 * panneau latéral, ou celui de chaque groupe dans une dock haute/basse. */
export function ListeMembres<T>({ elements, render }: { elements: readonly T[]; render: (element: T) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fenetre, setFenetre] = useState({ debut: 0, fin: 20, horizontal: false, pas: 54, ecart: 0 });
  const nombre = elements.length;

  useLayoutEffect(() => {
    const liste = ref.current;
    const groupes = liste?.closest<HTMLElement>(".sion-membres-groupes");
    if (!liste || !groupes || nombre <= SEUIL) return;
    let frame = 0;
    const mesurer = () => {
      const style = getComputedStyle(liste);
      const horizontal = style.display === "flex" && style.overflowX === "auto";
      const propre = horizontal || style.overflowY === "auto";
      const parent = propre ? liste : groupes;
      const pas = parseFloat(style.getPropertyValue("--sion-membre-pas")) || 54;
      const ecart = horizontal ? parseFloat(style.columnGap) || 0 : 0;
      const taille = horizontal ? parent.clientWidth : parent.clientHeight;
      const position = propre ? (horizontal ? parent.scrollLeft : parent.scrollTop)
        : parent.getBoundingClientRect().top - liste.getBoundingClientRect().top;
      const debut = Math.min(nombre, Math.max(0, Math.floor(position / pas) - MARGE));
      const fin = Math.min(nombre, Math.max(debut, Math.ceil((position + taille) / pas) + MARGE));
      setFenetre((avant) => avant.debut === debut && avant.fin === fin && avant.horizontal === horizontal
        && avant.pas === pas && avant.ecart === ecart ? avant : { debut, fin, horizontal, pas, ecart });
    };
    const planifier = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; mesurer(); });
    };
    mesurer();
    // Capture aussi les défilements des listes de chaque colonne.
    groupes.addEventListener("scroll", planifier, true);
    window.addEventListener("resize", planifier);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(planifier);
    observer?.observe(groupes);
    observer?.observe(liste);
    return () => {
      groupes.removeEventListener("scroll", planifier, true);
      window.removeEventListener("resize", planifier);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [nombre]);

  const debut = nombre > SEUIL ? Math.min(fenetre.debut, nombre) : 0;
  const fin = nombre > SEUIL ? Math.min(fenetre.fin, nombre) : nombre;
  const espace = (n: number) => n > 0 && <div aria-hidden="true" className="sion-membres-espace" style={fenetre.horizontal
    ? { width: Math.max(0, n * fenetre.pas - fenetre.ecart), flexShrink: 0 }
    : { height: n * fenetre.pas, flexShrink: 0 }} />;
  return <div ref={ref} className="sion-membres-liste">
    {espace(debut)}
    {elements.slice(debut, fin).map(render)}
    {espace(nombre - fin)}
  </div>;
}
