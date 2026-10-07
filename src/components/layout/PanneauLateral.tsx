import { Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLayoutStore, PANNEAU_MIN_WIDTH, PANNEAU_MAX_WIDTH, PANNEAU_DEFAULT_WIDTH, type PanneauId } from "../../stores/useLayoutStore";
import { PANNEAU_TITRES, PANNEAU_CORPS, PANNEAU_COMPTEURS } from "./panneaux";
import { Bulle } from "./Bulle";
import { ResizeHandle } from "./ResizeHandle";
import { CloseIcon } from "../icons";

function Compteur({ id }: { id: PanneauId }) {
  const useTotal = PANNEAU_COMPTEURS[id] ?? (() => null);
  const total = useTotal();
  return total == null ? null : <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, color: 'var(--color-on-surface-variant)', background: 'var(--color-surface-container-high)' }}>{total}</span>;
}

export function PanneauLateral() {
  const { t } = useTranslation();
  const panneau = useLayoutStore((s) => s.panneau);
  const largeur = useLayoutStore((s) => s.largeurPanneau);
  const fermer = useLayoutStore((s) => s.fermerPanneau);
  const setLargeur = useLayoutStore((s) => s.setLargeurPanneau);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panneau) return;
    const origine = document.activeElement as HTMLElement | null;
    const conteneur = ref.current;
    conteneur?.querySelector<HTMLButtonElement>('button[data-fermer-panneau]')?.focus();
    return () => {
      if (origine?.isConnected && (!document.activeElement || document.activeElement === document.body || conteneur?.contains(document.activeElement))) origine.focus();
    };
  }, [panneau]);
  if (!panneau) return null;
  const Corps = PANNEAU_CORPS[panneau];
  return <div ref={ref} className="sion-panneau" style={{ width: largeur }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } }}>
    <ResizeHandle side="left" value={largeur} min={PANNEAU_MIN_WIDTH} max={PANNEAU_MAX_WIDTH} onChange={setLargeur}
      onReset={() => setLargeur(PANNEAU_DEFAULT_WIDTH)} label={t("layout.resizePanel")} />
    <Bulle as="aside" scope={panneau} aria-label={t(PANNEAU_TITRES[panneau])} style={{ height: '100%', width: '100%' }}>
      <div className="sion-panneau-entete">
        <span style={{ fontSize: 14, fontWeight: 700 }}>{t(PANNEAU_TITRES[panneau])}</span>
        <Compteur key={panneau} id={panneau} />
        <button type="button" data-fermer-panneau aria-label={t("chat.close")} title={t("chat.close")} onClick={fermer}><CloseIcon /></button>
      </div>
      <Suspense fallback={<div style={{ padding: 16, fontSize: 12 }}>{t("chat.loading")}</div>}><Corps key={panneau} /></Suspense>
    </Bulle>
  </div>;
}
