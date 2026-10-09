import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import * as matrixService from "../../services/matrixService";
import { plainPreview } from "../../utils/plainPreview";
import { allerAuMessage } from "../../services/allerAuMessage";
import type { PinnedSummary } from "../../services/matrixService";
import { useCompteurPanneau } from "../layout/panneauxCompteurs";
import "./TextPanel.css";

/**
 * Liste complète des messages épinglés d'un salon.
 *
 * La barre des épinglés fait défiler les pins un par un, et seulement ceux dont
 * le message est déjà chargé : un épinglé de plusieurs mois en disparaissait.
 * Ce panneau les montre tous, en allant chercher sur le serveur ceux que le fil
 * local ne contient pas, et permet d'en rejoindre un directement.
 *
 * **Panneau ancrable, et non bulle flottante.** La première version s'ancrait
 * sous son bandeau en `position: absolute`. Or la vidéo d'un partage n'est pas
 * un élément de la page mais une fenêtre NATIVE posée par-dessus — sous-surface
 * Wayland, fenêtre enfant Win32 — qu'aucun `z-index` ne peut franchir : la
 * liste passait dessous dès qu'un partage était affiché (18/09). En panneau,
 * elle se déplace hors de la zone vidéo, comme la soundboard.
 */
export function PinnedListPanel() {
  const { t } = useTranslation();
  const activeChannel = useAppStore((s) => s.activeChannel);
  // Re-lire quand les épingles changent pendant que le panneau est ouvert.
  const pinnedVersion = useMatrixStore((s) => s.pinnedVersion);
  const [pins, setPins] = useState<PinnedSummary[] | null>(null);
  useCompteurPanneau("pinned", pins?.length ?? null);

  useEffect(() => {
    if (!activeChannel) return;
    let annule = false;
    setPins(null);
    void matrixService.getPinnedSummaries(activeChannel)
      .then((liste) => { if (!annule) setPins(liste); })
      .catch(() => { if (!annule) setPins([]); });
    return () => { annule = true; };
  }, [activeChannel, pinnedVersion]);

  const dateCourte = (ts: number) => ts
    ? new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <div className="sion-epingles">
      <div className="sion-epingles-liste" onWheel={(e) => {
        if (getComputedStyle(e.currentTarget).overflowY === "hidden") e.currentTarget.scrollLeft += e.deltaY;
      }}>
        {pins === null && (
          <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--color-outline)' }}>
            {t("chat.loading")}
          </div>
        )}

        {pins?.length === 0 && (
          <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--color-outline)' }}>
            {t("chat.pinnedNone", { defaultValue: "Aucun message épinglé" })}
          </div>
        )}

        {pins?.map((pin) => (
          <button
            key={pin.eventId}
            type="button"
            onClick={() => allerAuMessage(pin.eventId)}
            className="sion-epingle"
            title={plainPreview(pin.text) || t("chat.attachedFile", { defaultValue: "Fichier joint" })}
          >
            {/* Vignette du média : une image et une vidéo se reconnaissent d'un
                coup d'œil, là où le libellé « Fichier joint » ne disait rien de
                leur nature. */}
            {pin.mediaUrl && pin.media === "image" && (
              <img
                src={pin.mediaUrl}
                alt=""
                loading="lazy"
                className="sion-epingle-media"
              />
            )}
            {pin.mediaUrl && pin.media === "video" && (
              <AfficheVideo pin={pin} />
            )}

            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
              <div className="sion-epingle-auteur">
                <span title={pin.sender} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-primary)' }}>
                  {pin.sender}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-outline)' }}>
                  {dateCourte(pin.ts)}
                </span>
              </div>
              <div className="sion-epingle-texte">
                {plainPreview(pin.text) || t("chat.attachedFile", { defaultValue: "Fichier joint" })}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Affiche d'une vidéo épinglée.
 *
 * Jamais de balise `<video>` : cette version de WebKit ne lit pas les vidéos
 * du fil, et la vignette restait noire. Quand le serveur a une vignette,
 * `mediaUrl` la désigne déjà ; sinon ffmpeg extrait une image du média, comme
 * pour les cartes du fil, mise en cache côté Rust.
 */
function AfficheVideo({ pin }: { pin: PinnedSummary }) {
  const vignette = pin.mediaUrl && pin.mediaUrl !== pin.sourceUrl ? pin.mediaUrl : null;
  const [extraite, setExtraite] = useState<string | null>(null);
  // Extraire une affiche télécharge le début de la vidéo — jusqu'à 12 Mo — et
  // lance ffmpeg : seulement pour celles qui entrent à l'écran, pas pour toute
  // la liste à l'ouverture du panneau.
  const cadreRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const cadre = cadreRef.current;
    if (!cadre || vignette) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setVisible(true));
      return;
    }
    const io = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "100px" });
    io.observe(cadre);
    return () => io.disconnect();
  }, [vignette]);
  useEffect(() => {
    if (vignette || !visible || !pin.sourceUrl) return;
    let vivant = true;
    void import("../../services/voiceNativeService")
      .then((m) => m.afficheLecteurVideo(pin.sourceUrl!))
      .then((data) => { if (vivant) setExtraite(data); })
      .catch(() => { /* ffmpeg absent, ou format sans image */ });
    return () => { vivant = false; };
  }, [vignette, visible, pin.sourceUrl]);
  const image = vignette ?? extraite;
  return (
    <div ref={cadreRef} className="sion-epingle-media" style={{ position: 'relative', overflow: 'hidden' }}>
      {image && (
        <img src={image} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      )}
      {/* Le triangle distingue une vidéo d'une image au premier regard. */}
      <span aria-hidden style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-on-surface)', fontSize: 16, textShadow: '0 1px 3px var(--color-surface)',
      }}>
        ▶
      </span>
    </div>
  );
}
