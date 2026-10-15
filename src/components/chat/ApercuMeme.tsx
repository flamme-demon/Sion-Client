import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { figerApercuMeme } from "../../services/memePreview";
import { RefreshIcon } from "../icons";

const STYLE_IMAGE = { display: "block", width: "100%", height: "100%", objectFit: "cover" } as const;

function ImageFixeMeme({ src, onReessayer }: { src: string; onReessayer: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    const controle = new AbortController();
    let resultat: string | null = null;
    void figerApercuMeme(src, controle.signal).then((blob) => {
      if (controle.signal.aborted) return;
      resultat = URL.createObjectURL(blob);
      setUrl(resultat);
    }).catch((e: unknown) => {
      if (controle.signal.aborted) return;
      console.warn("[Sion][memeboard] static preview unavailable", e);
      setErreur(true);
    });
    return () => {
      controle.abort();
      if (resultat) URL.revokeObjectURL(resultat);
    };
  }, [src]);
  if (erreur) return <div className="sion-meme-apercu-erreur">
    <span aria-hidden="true">🎬</span>
    <button type="button" title={t("memeboard.retryPreview")} aria-label={t("memeboard.retryPreview")}
      onClick={(e) => { e.stopPropagation(); onReessayer(); }}><RefreshIcon /></button>
  </div>;
  return url ? <img src={url} alt="" style={STYLE_IMAGE} onError={() => setErreur(true)} /> : <span aria-hidden="true">🎬</span>;
}

/** Freeze once per visible tile; a real image survives compositor repainting. */
export function ApercuMeme({ src, anime }: { src: string; anime: boolean }) {
  const boite = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [essai, setEssai] = useState(0);
  useEffect(() => {
    if (!boite.current || typeof IntersectionObserver === "undefined") return;
    const observateur = new IntersectionObserver((entrees) => setVisible(entrees.some((e) => e.isIntersecting)), { rootMargin: "200px" });
    observateur.observe(boite.current);
    return () => observateur.disconnect();
  }, []);
  return <div ref={boite} className="sion-meme-apercu" style={{ position: "relative", width: "100%", height: "100%" }}>
    {visible && <>
      <ImageFixeMeme key={`${src}:${essai}`} src={src} onReessayer={() => setEssai((n) => n + 1)} />
      {anime && <img src={src} alt="" style={{ ...STYLE_IMAGE, position: "absolute", inset: 0, pointerEvents: "none" }} />}
    </>}
  </div>;
}
