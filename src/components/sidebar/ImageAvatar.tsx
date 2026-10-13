import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

// Certains médias fédérés existent mais le serveur refuse leur miniature.
// Garder ce choix au remontage évite de redemander la miniature à chaque visite.
const miniaturesIndisponibles = new Set<string>();
const CACHE_MAX = 256;

function originalAvatar(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== "sion-media:" && url.hostname !== "sion-media.localhost") return null;
    if (url.searchParams.get("avatar") !== "1") return null;
    url.searchParams.delete("avatar");
    return url.href;
  } catch { return null; }
}

/** Miniature, puis original si nécessaire, puis initiale si le média manque. */
export function ImageAvatar({ src, fallback, loading = "lazy", decoding = "async", ...props }:
  Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & { src: string; fallback: ReactNode }) {
  const [echec, setEchec] = useState<{ src: string; url: string } | null>(null);
  const original = originalAvatar(src);
  const erreur = echec?.src === src ? echec.url : null;
  const cible = original && (miniaturesIndisponibles.has(src) || erreur === src) ? original : src;
  if (erreur === cible) return <>{fallback}</>;
  return <img {...props} src={cible} loading={loading} decoding={decoding} onError={() => {
    if (cible === src && original) {
      miniaturesIndisponibles.add(src);
      if (miniaturesIndisponibles.size > CACHE_MAX) miniaturesIndisponibles.delete(miniaturesIndisponibles.values().next().value!);
    }
    setEchec({ src, url: cible });
  }} />;
}
