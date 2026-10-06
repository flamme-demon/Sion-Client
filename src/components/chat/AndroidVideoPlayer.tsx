import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileAttachment } from "../../types/matrix";
import { urlLecture, retenirMediaLecture, libererMediaLecture } from "../../services/matrixCore";
import { createDecryptedObjectUrl } from "../../utils/decryptMedia";
import { definirLecteurActif, libererLecteurActif, useEstLecteurActif } from "../../services/lecteurActif";

interface Props {
  attachment: FileAttachment;
  ratio: string;
}

/** Aucun lecteur ni octet vidéo avant le clic, même pour les médias chiffrés.
 * Changer de vidéo démonte le précédent lecteur et libère son décodeur. */
export function AndroidVideoPlayer({ attachment, ratio }: Props) {
  const { t } = useTranslation();
  const instance = useId();
  const id = `${attachment.id}:${instance}`;
  const active = useEstLecteurActif(id);
  useEffect(() => () => libererLecteurActif(id), [id]);
  const style = {
    display: 'block', width: '100%', maxHeight: 340, aspectRatio: ratio,
    borderRadius: 14, background: 'var(--color-surface-container-highest)',
  };
  if (!active) {
    return <button type="button" aria-label={t("chat.play")} disabled={!attachment.url}
      onClick={() => definirLecteurActif(id)}
      style={{ ...style, position: 'relative', overflow: 'hidden', border: 0, padding: 0, cursor: 'pointer', color: 'var(--color-on-surface)' }}>
      {attachment.thumbnailUrl && <img src={attachment.thumbnailUrl} alt="" loading="lazy"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />}
      <span style={{ position: 'relative', display: 'inline-flex', gap: 8, alignItems: 'center', padding: '10px 16px', borderRadius: 24, background: 'var(--color-surface-container-high)' }}>
        <span aria-hidden="true">▶</span> {t("chat.play")}
      </span>
    </button>;
  }
  return <>
    <Player key={attachment.url} id={id} attachment={attachment} ratio={ratio} />
    <button type="button" onClick={() => libererLecteurActif(id)}
      style={{ display: 'block', marginTop: 4, fontSize: 11 }}>{t("chat.closePlayer")}</button>
  </>;
}

/** Rust sert les octets déchiffrés et les plages HTTP sur la boucle locale :
 * le protocole intercepté du WebView gère mal certaines plages MP4. */
function Player({ attachment, ratio, id }: Props & { id: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { url: source, encryptedFile, mimeType } = attachment;
  useEffect(() => {
    if (!source) return;
    let active = true;
    let objectUrl: string | null = null;
    let lease: number | null = null;
    const resolve = async () => {
      if (!encryptedFile) {
        lease = await retenirMediaLecture(source);
        if (!active) {
          if (lease !== null) void libererMediaLecture(lease).catch(() => {});
          return;
        }
      }
      const address = encryptedFile
        ? (objectUrl = await createDecryptedObjectUrl(source, encryptedFile, mimeType))
        : await urlLecture(source);
      if (!active) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (address) setUrl(address);
      else setFailed(true);
    };
    void resolve().catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (lease !== null) void libererMediaLecture(lease).catch(() => {});
    };
  }, [source, encryptedFile, mimeType, attempt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    void video.play().catch(() => { /* Les commandes restent disponibles. */ });
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, failed]);

  if (failed) {
    return <div role="alert" style={{ padding: '8px 12px', fontSize: 12 }}>
      {t("chat.videoPlayFailed")}{" "}
      <button type="button" onClick={() => {
        setUrl(null);
        setFailed(false);
        setAttempt((value) => value + 1);
      }}>{t("chat.videoRetry")}</button>
    </div>;
  }
  if (!url) {
    return <div role="status" style={{ padding: '8px 12px', borderRadius: 14, background: 'var(--color-surface-container-high)', color: 'var(--color-outline)', fontSize: 12 }}>
      {t("chat.loading")}
    </div>;
  }
  return <video
    ref={videoRef}
    controls
    playsInline
    preload="none"
    src={url}
    poster={attachment.thumbnailUrl ?? undefined}
    onError={() => setFailed(true)}
    onEnded={() => libererLecteurActif(id)}
    style={{
      display: 'block', width: '100%', maxHeight: 340, aspectRatio: ratio,
      borderRadius: 14, background: 'var(--color-surface-container-highest)',
    }}
  />;
}
