import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { figerApercuMeme } from "./memePreview";
const mock = vi.hoisted(() => ({ urlLecture: vi.fn() }));
vi.mock("./matrixCore", () => ({ urlLecture: mock.urlLecture }));
const creer = vi.fn(), revoquer = vi.fn(), dessiner = vi.fn(), decode = vi.fn();
let image: { src: string; naturalWidth: number; naturalHeight: number; decode: typeof decode };
let canvas: HTMLCanvasElement;
let png: Blob;
beforeEach(() => {
  vi.resetAllMocks();
  png = new Blob(["png"], { type: "image/png" });
  mock.urlLecture.mockImplementation(async (src: string) => src.startsWith("sion-media:") ? "http://127.0.0.1:1234/matrix/image" : src);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["animated webp"], { type: "image/webp" }) }));
  vi.stubGlobal("URL", { createObjectURL: creer.mockReturnValue("blob:source"), revokeObjectURL: revoquer });
  image = { src: "", naturalWidth: 1280, naturalHeight: 720, decode: decode.mockResolvedValue(undefined) };
  vi.stubGlobal("Image", class { constructor() { return image; } });
  const creerElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const element = creerElement(tag);
    if (tag === "canvas") {
      canvas = element as HTMLCanvasElement;
      vi.spyOn(canvas, "getContext").mockReturnValue({ drawImage: dessiner } as unknown as CanvasRenderingContext2D);
      vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(png));
    }
    return element;
  }) as typeof document.createElement);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("convertit la première image en PNG carré borné, puis libère le décodeur et le canvas", async () => {
  expect(await figerApercuMeme("https://media.test/preview.webp", new AbortController().signal)).toBe(png);
  expect(dessiner).toHaveBeenCalledWith(image, 280, 0, 720, 720, 0, 0, 256, 256);
  expect(canvas.width).toBe(1); expect(canvas.height).toBe(1); expect(image.src).toBe("");
  expect(revoquer).toHaveBeenCalledExactlyOnceWith("blob:source");
});
it("ne grossit pas une petite vignette et lit sion-media par le serveur local", async () => {
  image.naturalWidth = 120; image.naturalHeight = 160;
  const controle = new AbortController();
  await figerApercuMeme("sion-media://localhost/image", controle.signal);
  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:1234/matrix/image", { signal: controle.signal });
  expect(dessiner).toHaveBeenCalledWith(image, 0, 20, 120, 120, 0, 0, 120, 120);
});
it("annule le décodage et libère ses ressources sans attendre une image bloquée", async () => {
  let commencer!: () => void;
  const commence = new Promise<void>((resolve) => { commencer = resolve; });
  decode.mockImplementation(() => { commencer(); return new Promise(() => {}); });
  const controle = new AbortController();
  const attente = figerApercuMeme("https://media.test/preview.webp", controle.signal);
  await commence;
  controle.abort();
  await expect(attente).rejects.toMatchObject({ name: "AbortError" });
  expect(revoquer).toHaveBeenCalledExactlyOnceWith("blob:source");
  expect(image.src).toBe(""); expect(canvas.width).toBe(1);
});
it("ne crée aucun décodeur si le média ou le serveur local est indisponible", async () => {
  mock.urlLecture.mockResolvedValueOnce(null);
  await expect(figerApercuMeme("sion-media://localhost/image", new AbortController().signal)).rejects.toThrow("unavailable");
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
  await expect(figerApercuMeme("https://media.test/absent.webp", new AbortController().signal)).rejects.toThrow("404");
  expect(creer).not.toHaveBeenCalled();
});
it("signale l'échec d'encodage et ferme quand même l'image source", async () => {
  const valeur = document.createElement("canvas");
  vi.spyOn(document, "createElement").mockReturnValue(valeur);
  vi.mocked(valeur.toBlob).mockImplementation((callback) => callback(null));
  await expect(figerApercuMeme("https://media.test/preview.webp", new AbortController().signal)).rejects.toThrow("encoding failed");
  expect(revoquer).toHaveBeenCalledExactlyOnceWith("blob:source");
});
