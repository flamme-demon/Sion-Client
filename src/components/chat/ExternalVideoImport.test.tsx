import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { ExternalVideoImport } from "./ExternalVideoImport";

const outils = vi.hoisted(() => ({ analyser: vi.fn(), importer: vi.fn(), annuler: vi.fn(), imported: vi.fn(), fermer: vi.fn() }));
vi.mock("../../services/ytdlpService", () => ({
  probeUrlFormats: outils.analyser, importUrlVideo: outils.importer, annulerImportVideo: outils.annuler,
}));
vi.mock("../../services/ytdlpInstall", () => ({ detectYtdlp: async () => "yt-dlp", installYtdlp: vi.fn() }));
vi.mock("../../services/matrixService", () => ({ getMaxUploadSize: async () => 20 * 1024 * 1024 }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options?: { defaultValue?: string; size?: string }) =>
    options?.defaultValue?.replace("{{size}}", options.size ?? "") ?? key,
}) }));

const vue = montage();
beforeEach(() => {
  vi.clearAllMocks();
  outils.analyser.mockResolvedValue({ duration: 248, title: "Vidéo X", options: [
    { height: 270, codec: "H.264", ext: "mp4", size: 5.4 * 1024 * 1024 },
    { height: 360, codec: "H.264", ext: "mp4", size: 16.6 * 1024 * 1024 },
    { height: 720, codec: "H.264", ext: "mp4", size: 46.3 * 1024 * 1024 },
  ] });
  outils.importer.mockResolvedValue(new File([new Uint8Array([1])], "video.mp4", { type: "video/mp4" }));
});
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const choix = (height: number) => [...dialog().querySelectorAll("label")].find((label) => label.textContent?.includes(`${height}p`))!;
const radio = (height: number) => choix(height).querySelector<HTMLInputElement>('input[type="radio"]')!;
async function saisir(champ: HTMLInputElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(champ, valeur);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function analyser() {
  await vue.render(<ExternalVideoImport onImported={outils.imported} onClose={outils.fermer} />);
  await saisir(dialog().querySelector<HTMLInputElement>('input')!, "https://x.com/test/status/123");
  await act(async () => [...dialog().querySelectorAll("button")].find((b) => b.textContent === "extAudio.analyze")!.click());
}
async function importer() {
  await act(async () => [...dialog().querySelectorAll("button")].find((b) => b.textContent === "extVideo.download")!.click());
}

it("cancels the link probe when the dialog closes", async () => {
  outils.analyser.mockImplementation(() => new Promise(() => {}));
  await analyser();
  const signal = outils.analyser.mock.calls[0][1] as AbortSignal;
  expect(signal.aborted).toBe(false);
  await act(async () => [...dialog().querySelectorAll("button")].find((b) => b.textContent === "poll.cancel")!.click());
  expect(signal.aborted).toBe(true);
  expect(outils.fermer).toHaveBeenCalledOnce();
});

it("cancels the link probe on unmount or room change", async () => {
  outils.analyser.mockImplementation(() => new Promise(() => {}));
  await analyser();
  const signal = outils.analyser.mock.calls[0][1] as AbortSignal;
  await vue.render(null);
  expect(signal.aborted).toBe(true);
});

it("changing the URL cancels the old probe and makes another analysis possible", async () => {
  outils.analyser.mockImplementation(() => new Promise(() => {}));
  await analyser();
  const signal = outils.analyser.mock.calls[0][1] as AbortSignal;
  await saisir(dialog().querySelector<HTMLInputElement>('input')!, "https://x.com/other/status/456");
  expect(signal.aborted).toBe(true);
  expect([...dialog().querySelectorAll("button")].find((b) => b.textContent === "extAudio.analyze")!.disabled).toBe(false);
});

it("garde par défaut le meilleur fichier d'origine qui tient dans la limite", async () => {
  await analyser();
  expect(radio(360).checked).toBe(true);
  expect(choix(360).textContent).toContain("H.264 · tel quel");
  await importer();
  expect(outils.importer).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ height: 360, maxBytes: 20 * 1024 * 1024, recodeWebm: false }), expect.any(Function));
});

it("propose le 720p trop lourd avec la compression AV1 et transmet sa limite", async () => {
  await analyser();
  expect(radio(720).disabled).toBe(false);
  expect(choix(720).textContent).toContain("H.264 · compression AV1 vers 20.0 Mo max.");
  await act(async () => radio(720).click());
  await importer();
  expect(outils.importer).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ height: 720, maxBytes: 20 * 1024 * 1024, recodeWebm: false }), expect.any(Function));
  expect(outils.imported).toHaveBeenCalledOnce();
});

it("la compression reste proposée quand aucun format d'origine ne tient", async () => {
  outils.analyser.mockResolvedValue({ duration: 248, title: "Vidéo X", options: [{ height: 720, codec: "H.264", ext: "mp4", size: 46.3 * 1024 * 1024 }] });
  await analyser();
  expect(radio(720).checked).toBe(true);
  expect(radio(720).disabled).toBe(false);
  await importer();
  expect(outils.imported).toHaveBeenCalledOnce();
});

it("évalue la taille de la plage choisie avant de proposer la compression", async () => {
  outils.analyser.mockResolvedValue({ duration: 600, title: "Vidéo longue", options: [{ height: 720, codec: "H.264", ext: "mp4", size: 100 * 1024 * 1024 }] });
  await analyser();
  await saisir(dialog().querySelector<HTMLInputElement>('[placeholder="1:30"]')!, "0:00");
  await saisir(dialog().querySelector<HTMLInputElement>('[placeholder="1:55"]')!, "1:00");
  expect(choix(720).textContent).toContain("tel quel");
  expect(choix(720).textContent).toContain("~10.0 Mo");
  await saisir(dialog().querySelector<HTMLInputElement>('[placeholder="1:55"]')!, "5:00");
  expect(choix(720).textContent).toContain("compression AV1");
  expect(choix(720).textContent).toContain("~50.0 Mo");
});
