import { urlLecture } from "./matrixCore";

/** Build a static thumbnail; keep animated decoders and canvases out of the grid. */
export async function figerApercuMeme(src: string, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const source = await urlLecture(src);
  signal.throwIfAborted();
  if (!source) throw new Error("Meme preview media server unavailable");
  const reponse = await fetch(source, { signal });
  if (!reponse.ok) throw new Error(`Meme preview: HTTP ${reponse.status}`);
  const blob = await reponse.blob();
  signal.throwIfAborted();
  // A local blob keeps the canvas origin-clean, including custom media protocols.
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const canvas = document.createElement("canvas");
  let arreter!: () => void;
  const interruption = new Promise<never>((_, reject) => {
    arreter = () => reject(signal.reason ?? new DOMException("Preview cancelled", "AbortError"));
    signal.addEventListener("abort", arreter, { once: true });
  });
  try {
    image.src = url;
    await Promise.race([image.decode(), interruption]);
    signal.throwIfAborted();
    const cote = Math.min(image.naturalWidth, image.naturalHeight);
    if (!cote) throw new Error("Meme preview has no pixels");
    const taille = Math.min(cote, 256);
    canvas.width = taille; canvas.height = taille;
    const contexte = canvas.getContext("2d");
    if (!contexte) throw new Error("Meme preview canvas unavailable");
    contexte.drawImage(image, (image.naturalWidth - cote) / 2, (image.naturalHeight - cote) / 2, cote, cote, 0, 0, taille, taille);
    const fixe = await Promise.race([new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((resultat) => resultat ? resolve(resultat) : reject(new Error("Meme preview encoding failed")), "image/png");
    }), interruption]);
    signal.throwIfAborted();
    return fixe;
  } finally {
    signal.removeEventListener("abort", arreter);
    image.src = "";
    canvas.width = 1; canvas.height = 1;
    URL.revokeObjectURL(url);
  }
}
