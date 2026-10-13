import { afterEach, beforeEach, expect, it, vi } from "vitest";

const outils = vi.hoisted(() => ({ invoke: vi.fn(), affiche: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: outils.invoke }));
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn() }));
vi.mock("./voiceNativeService", () => ({ afficheLecteurVideo: outils.affiche }));
vi.mock("./matrixService", () => ({ getMaxUploadSize: async () => 20 * 1024 * 1024 }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: { getState: () => ({ ffmpegPath: "ffmpeg" }) } }));
import { prepareVideoForSend } from "./videoPrepare";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  outils.invoke.mockImplementation(async (commande: string) => {
    if (commande === "stage_media") return "/tmp/sion-media/entree.webm";
    if (commande === "prepare_video_for_send") return {
      path: "/tmp/sion-media/sortie.webm", mimetype: "video/webm",
      width: 1920, height: 1080, durationMs: 100_000, transcoded: false,
    };
    if (commande === "read_media") return new Uint8Array([1, 2, 3]).buffer;
    throw new Error(`Commande inattendue : ${commande}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

it("fabrique la miniature sur le fichier local préparé, avant tout envoi", async () => {
  outils.affiche.mockResolvedValue("data:image/jpeg;base64,/9j/");
  const source = new File([new Uint8Array([1, 2, 3])], "clip.webm", { type: "video/webm" });
  const resultat = await prepareVideoForSend(source);
  expect(outils.affiche).toHaveBeenCalledExactlyOnceWith("/tmp/sion-media/sortie.webm");
  expect(resultat.thumbnail?.type).toBe("image/jpeg");
  expect([...new Uint8Array(await resultat.thumbnail!.arrayBuffer())]).toEqual([255, 216, 255]);
  expect(resultat.transcoded).toBe(false);
  expect(resultat.file.name).toBe("clip.webm");
});

it("l'absence d'image ne bloque pas l'envoi de la vidéo", async () => {
  outils.affiche.mockRejectedValue(new Error("aucune image extraite"));
  const resultat = await prepareVideoForSend(new File([new Uint8Array([1])], "clip.webm", { type: "video/webm" }));
  expect(resultat.thumbnail).toBeUndefined();
  expect(resultat.file.size).toBe(3);
  expect(resultat.width).toBe(1920);
});
