import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLayoutStore, type BackgroundScope } from "../../stores/useLayoutStore";
import { pickPanelBackground, usePanelBackgroundUrl, bgAnchorCss } from "../../services/panelBackground";
import { CloseIcon } from "../icons";

/**
 * Contrôle d'édition d'un fond d'image : choisir / remplacer, régler
 * l'opacité, retirer. Affiché dans les réglages d'apparence ; la bulle
 * conserve seulement le calque de fond.
 */
export function BackgroundControls({ scope, inline = false, label }: { scope: BackgroundScope; inline?: boolean; label?: string }) {
  const { t } = useTranslation();
  const cfg = useLayoutStore((s) => s.panelBackgrounds[scope]);
  const setPanelBackground = useLayoutStore((s) => s.setPanelBackground);
  // Déclaré AVANT tout retour anticipé : un hook appelé conditionnellement
  // casse l'ordre des hooks et vide l'écran au premier rendu où la condition
  // change — c'est exactement ce qui s'est produit le 17/09.
  const [enCours, setEnCours] = useState(false);
  if (!inline) return null;

  const hasImage = !!cfg;
  return (
    <div className={`sion-reglage-fond${hasImage ? " sion-reglage-fond--actif" : ""}`}>
      <div className="sion-reglage-fond-entete">
        <span>{label}</span>
        <button
          className="sion-reglage-fond-action"
          type="button"
          // Une vidéo est transcodée à l'import, ce qui prend de plusieurs
          // secondes à une minute selon le fichier. Sans retour visuel, le clic
          // paraissait sans effet et l'on recommençait (18/09).
          disabled={enCours}
          onClick={() => {
            setEnCours(true);
            void pickPanelBackground(scope).finally(() => setEnCours(false));
          }}
          aria-label={t(hasImage ? "layout.bgReplace" : "layout.bgPick")}
          aria-busy={enCours}
          title={enCours
            ? t("layout.bgPreparing", { defaultValue: "Préparation du fond…" })
            : hasImage
              ? t("layout.bgReplace", { defaultValue: "Remplacer l'image de fond" })
              : t("layout.bgPick", { defaultValue: "Choisir une image de fond" })}
        >
          {enCours ? (
            // Sablier animé par la même rotation que les autres attentes.
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.219-8.56">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
              </path>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          )}
        </button>
        {hasImage && <button
          className="sion-reglage-fond-action"
          type="button"
          onClick={() => setPanelBackground(scope, null)}
          title={t("layout.bgRemove", { defaultValue: "Retirer le fond" })}
          aria-label={t("layout.bgRemove", { defaultValue: "Retirer le fond" })}
        ><CloseIcon /></button>}
      </div>
      {hasImage && (
        <div className="sion-reglage-fond-options">
          <div className="sion-reglage-fond-ligne">
            <button
              className="sion-reglage-fond-mode"
              type="button"
              onClick={() => {
                const next = cfg.mode === "blur" ? "veil" : "blur";
                setPanelBackground(scope, { ...cfg, mode: next });
              }}
              title={t("layout.bgMode", { defaultValue: "Voile de lisibilité / fond flouté (image pleine)" })}
              aria-label={t("layout.bgMode", { defaultValue: "Voile de lisibilité / fond flouté (image pleine)" })}
            >
              {cfg.mode === "blur"
                ? t("layout.bgModeBlur", { defaultValue: "Flou" })
                : t("layout.bgModeVeil", { defaultValue: "Voile" })}
            </button>
            <label className="sion-reglage-fond-opacite">
              <span>{t("layout.bgOpacity", { defaultValue: "Opacité du fond" })}<output>{Math.round(cfg.opacity * 100)} %</output></span>
              <input
                type="range" min={0.05} max={1} step={0.05} value={cfg.opacity}
                onChange={(e) => {
                  const next = parseFloat(e.target.value);
                  const current = useLayoutStore.getState().panelBackgrounds[scope];
                  if (current) setPanelBackground(scope, { ...current, opacity: next });
                }}
                title={t("layout.bgOpacity", { defaultValue: "Opacité du fond" })}
                aria-label={t("layout.bgOpacity", { defaultValue: "Opacité du fond" })}
              />
            </label>
          </div>
          {/* Ancrage : « cover » recadre l'image — choisir la zone conservée
              (une photo portrait dans un panneau large : garder le haut). */}
          <div className="sion-reglage-fond-position">
            <span>{t("layout.bgPosition", { defaultValue: "Position" })}</span>
            <div
              className="sion-reglage-fond-ancrage"
              role="group"
              aria-label={t("layout.bgAnchor", { defaultValue: "Zone de l'image conservée quand elle est recadrée" })}
              title={t("layout.bgAnchor", { defaultValue: "Zone de l'image conservée quand elle est recadrée" })}
            >
              {(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-label={a}
                  aria-pressed={(cfg.anchor ?? "mc") === a}
                  onClick={() => setPanelBackground(scope, { ...cfg, anchor: a })}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Couche d'image floutée (mode « flou ») : l'image est peinte dans un calque
 * flouté SOUS le contenu — on ne peut pas flouter un `background-image` posé
 * sur le conteneur, d'où cette couche dédiée. À monter en **premier enfant**
 * d'un conteneur `position: relative` : le contenu, peint après dans le DOM,
 * passe naturellement au-dessus.
 */
export function PanelBackgroundLayer({ scope }: { scope: BackgroundScope }) {
  const cfg = useLayoutStore((s) => s.panelBackgrounds[scope]);
  const url = usePanelBackgroundUrl(scope);
  if (!cfg || !url) return null;

  const veil = `color-mix(in srgb, var(--color-surface-container-low) ${Math.round((1 - cfg.opacity) * 100)}%, transparent)`;
  if (cfg.mode !== "blur") {
    // Mode « voile » : l'image est une <img> sur SA couche de composition
    // (`will-change`), pas un `background-image` du conteneur. Posée en fond
    // du conteneur, chaque image d'un fond animé (WebP ~24 i/s) faisait
    // repeindre tout le panneau, messages compris : ~50 % d'un cœur entre le
    // fil principal et le pilote GPU, mesuré le 26/09. Sur sa couche, seule
    // l'image est repeinte — ~37 % au total, et plus rien côté messages.
    //
    // Niveau -1, dans un conteneur isolé (`usePanelBackgroundStyle`) : le
    // contenu passe par-dessus d'un seul tenant, sans que chaque bloc doive
    // devenir sa propre couche.
    return (
      <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none', overflow: 'hidden' }}>
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: bgAnchorCss(cfg.anchor),
            willChange: 'transform',
            // Ce fond, invisible sous l'image recadrée, n'est pas décoratif :
            // il empêche WebKit d'en faire une « couche directe ». Dans ce
            // mode, chaque image de l'animation est décodée de façon
            // synchrone sur le fil principal, et le défilement des messages
            // saccadait (fil principal à 81–86 %, 26/09). Peinte dans sa
            // couche, l'image est décodée sur le fil dédié de WebKit.
            background: 'var(--color-surface-container-low)',
          }}
        />
        <div style={{ position: 'absolute', inset: 0, background: veil }} />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        // Déborde du conteneur : les bords adoucis par le flou restent hors
        // champ (sinon on voit une bande claire sur les bords).
        inset: -32,
        zIndex: -1,
        pointerEvents: 'none',
        backgroundImage: `linear-gradient(${veil}, ${veil}), url(${url})`,
        backgroundSize: 'cover',
        backgroundPosition: bgAnchorCss(cfg.anchor),
        backgroundRepeat: 'no-repeat',
        filter: 'blur(16px)',
      }}
    />
  );
}
