import { useRef, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

export type RegionMeme = { debut: number; fin: number };
export type GlissementMeme = "debut" | "fin" | "selection";

interface Props {
  nom: string;
  fenetre: RegionMeme;
  region: RegionMeme;
  curseur: number | null;
  deplacerSelection: boolean;
  desactive: boolean;
  onSaisir: (e: PointerEvent, mode: GlissementMeme, msParPixel: number) => void;
  onFond: (e: PointerEvent, instant: number, msParPixel: number) => void;
  onTouche: (borne: "debut" | "fin", e: React.KeyboardEvent) => void;
}

/** Les deux pistes partagent les mêmes bornes, avec un repère temporel propre.
 * La géométrie du geste est capturée à la saisie pour éviter les sauts du zoom. */
export function PisteMeme({ nom, fenetre, region, curseur, deplacerSelection, desactive, onSaisir, onFond, onTouche }: Props) {
  const { t } = useTranslation();
  const piste = useRef<HTMLDivElement>(null);
  const duree = Math.max(1, fenetre.fin - fenetre.debut);
  const pct = (instant: number) => Math.max(0, Math.min(100, (instant - fenetre.debut) / duree * 100));
  const gauche = pct(region.debut);
  const droite = pct(region.fin);
  const msParPixel = () => duree / Math.max(1, piste.current?.getBoundingClientRect().width ?? 1);
  const saisir = (e: PointerEvent, mode: GlissementMeme) => {
    if (desactive) return;
    onSaisir(e, mode, msParPixel());
  };
  const borne = (quel: "debut" | "fin") => {
    if (region[quel] < fenetre.debut || region[quel] > fenetre.fin) return null;
    const label = t(quel === "debut" ? "memeboard.startFrame" : "memeboard.endFrame");
    return <div
      role="slider" tabIndex={desactive ? -1 : 0} aria-label={label} title={label}
      aria-valuemin={0} aria-valuemax={Math.max(fenetre.fin, region.fin)} aria-valuenow={region[quel]}
      aria-valuetext={`${(region[quel] / 1000).toFixed(3)} s`} aria-disabled={desactive}
      onPointerDown={(e) => saisir(e, quel)}
      onKeyDown={(e) => onTouche(quel, e)}
      style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(region[quel])}%`, width: 12, marginLeft: -6, borderRadius: 4, cursor: "ew-resize", background: "var(--color-primary)", zIndex: 2 }}
    />;
  };
  const labelTemps = (ms: number) => {
    const s = Math.max(0, ms) / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(duree < 5000 ? 2 : 1).padStart(duree < 5000 ? 5 : 4, "0")}`;
  };
  return <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
    <div
      ref={piste} role="group" aria-label={nom} aria-disabled={desactive}
      onPointerDown={(e) => {
        if (desactive) return;
        const boite = piste.current!.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - boite.left) / Math.max(1, boite.width)));
        onFond(e, fenetre.debut + ratio * duree, msParPixel());
      }}
      style={{ position: "relative", height: 50, marginInline: 6, borderRadius: 8, touchAction: "none", userSelect: "none", cursor: "crosshair", background: "var(--color-surface-container-highest)", opacity: desactive ? 0.5 : 1 }}
    >
      {Array.from({ length: 21 }, (_, i) => <span key={i} aria-hidden="true" style={{ position: "absolute", bottom: 0, left: `${i * 5}%`, height: i % 5 === 0 ? 15 : 7, borderLeft: "1px solid var(--color-outline)", opacity: 0.4, pointerEvents: "none" }} />)}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: 8, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, right: `${100 - gauche}%`, background: "var(--color-scrim, rgba(0,0,0,0.35))" }} />
        <div style={{ position: "absolute", inset: 0, left: `${droite}%`, background: "var(--color-scrim, rgba(0,0,0,0.35))" }} />
      </div>
      {region.fin >= fenetre.debut && region.debut <= fenetre.fin && <div
        onPointerDown={deplacerSelection ? (e) => saisir(e, "selection") : undefined}
        style={{ position: "absolute", top: 0, bottom: 0, left: `${gauche}%`, width: `${Math.max(droite - gauche, 0.4)}%`, border: "2px solid var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 18%, transparent)", borderRadius: 5, cursor: deplacerSelection ? "grab" : "inherit", pointerEvents: deplacerSelection ? "auto" : "none" } as CSSProperties}
      />}
      {borne("debut")}{borne("fin")}
      {curseur !== null && curseur >= fenetre.debut && curseur <= fenetre.fin && <div aria-hidden="true" style={{ position: "absolute", top: -3, bottom: -3, left: `${pct(curseur)}%`, width: 2, background: "var(--color-amber)", pointerEvents: "none", zIndex: 3 }} />}
    </div>
    <div aria-hidden="true" style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-outline)", marginInline: 6 }}>
      {[0, 0.5, 1].map((p) => <span key={p}>{labelTemps(fenetre.debut + duree * p)}</span>)}
    </div>
  </div>;
}
