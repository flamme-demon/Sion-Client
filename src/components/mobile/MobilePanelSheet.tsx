import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { PANNEAU_CORPS, PANNEAU_TITRES } from "../layout/panneaux";
import { CloseIcon } from "../icons";

/**
 * Téléphone : le panneau courant s'ouvre en feuille qui monte du bas.
 * Fermer la feuille ferme le panneau (croix, fond, retour d'Android).
 */
export function MobilePanelSheet() {
  const { t } = useTranslation();
  const courant = useLayoutStore((s) => s.panneau);

  if (!courant) return null;
  const Corps = PANNEAU_CORPS[courant];
  const fermer = () => useLayoutStore.getState().fermerPanneau();

  return (
    <div
      onClick={fermer}
      style={{
        position: "fixed", inset: 0, zIndex: 900,
        background: "rgba(0,0,0,0.45)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "85vh",
          background: "var(--color-surface-container-low)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 2px" }}>
          <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--color-outline-variant)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", padding: "4px 8px 8px 16px", gap: 8 }}>
          <span className="sion-titre" style={{ flex: 1, fontSize: 16, fontWeight: 600, color: "var(--color-on-surface)" }}>
            {t(PANNEAU_TITRES[courant])}
          </span>
          <button
            type="button"
            data-fermer-panneau
            onClick={fermer}
            aria-label={t("chat.close", { defaultValue: "Fermer" })}
            style={{
              width: 44, height: 44, borderRadius: 22, border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <CloseIcon />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Suspense fallback={null}>
            <Corps />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
