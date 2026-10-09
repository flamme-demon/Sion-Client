import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { LIBELLES_PLACEMENT, useApercuPlacementModule } from "./apercuPlacementModule";
import { PANNEAU_TITRES } from "./panneaux";

/** Seule cette petite carte suit chaque pixel : les modules restent montés. */
export function ModuleEnMain() {
  const { t } = useTranslation();
  const saisie = useApercuPlacementModule((s) => s.saisie);
  const cible = useApercuPlacementModule((s) => s.cible);
  if (!saisie) return null;
  const largeur = Math.min(230, window.innerWidth - 16);
  const x = Math.max(8, Math.min(saisie.x + 18, window.innerWidth - largeur - 8));
  const y = Math.max(8, Math.min(saisie.y + 18, window.innerHeight - 112));
  return createPortal(<div className="sion-module-en-main" aria-hidden="true"
    style={{ position: "fixed", left: x, top: y, width: largeur }}>
    <div className="sion-module-en-main-titre"><span className="sion-poignee-module">⠿</span>{t(PANNEAU_TITRES[saisie.id])}</div>
    <span>{cible ? t(LIBELLES_PLACEMENT[cible.zone]) : t("layout.moveToEdge", { defaultValue: "Glisse vers un bord" })}</span>
    {cible && <small>{t("layout.dropPanelHere", { defaultValue: "Relâche pour placer" })}</small>}
  </div>, document.body);
}
