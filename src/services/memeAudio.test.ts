import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
const mocks = vi.hoisted(() => ({ decode: vi.fn(), play: vi.fn(), stop: vi.fn() }));
vi.mock("./audioContext", () => ({ getSharedAudioContext: () => ({ decodeAudioData: mocks.decode }) }));
vi.mock("./nativeAudioPlayback", () => ({ playNativeBuffer: mocks.play }));
import { playMemeVideo } from "./memeAudio";

let video: HTMLVideoElement;
let stop: (() => void) | undefined;
let visual: Mock<() => Promise<void>>;
const flush = async () => { for (let step = 0; step < 8; step++) await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks();
  video = document.createElement("video");
  visual = vi.fn().mockResolvedValue(undefined);
  video.play = visual;
  video.pause = vi.fn();
  video.load = vi.fn();
  mocks.decode.mockResolvedValue({ duration: 8 });
  mocks.play.mockReturnValue({ ready: Promise.resolve(), stop: mocks.stop });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }));
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("garde le WebView muet et prépare le son natif avant de lancer l'image", async () => {
  let ready!: () => void;
  mocks.play.mockReturnValue({ ready: new Promise<void>((resolve) => { ready = resolve; }), stop: mocks.stop });
  stop = playMemeVideo(video, "blob:meme", 0.6, 10);
  expect(video.muted).toBe(true);
  await flush();
  expect(mocks.play).toHaveBeenCalledWith({ duration: 8 }, 0, 8, expect.objectContaining({ gain: 0.6 }));
  expect(visual).not.toHaveBeenCalled();
  ready();
  await flush();
  expect(visual).toHaveBeenCalledOnce();
});

it("borne le son et corrige un retard visuel avec l'horloge native", async () => {
  mocks.decode.mockResolvedValue({ duration: 30 });
  stop = playMemeVideo(video, "blob:meme", 1, 10);
  await flush();
  expect(mocks.play.mock.calls[0][2]).toBe(10);
  Object.defineProperty(video, "readyState", { value: 1 });
  const { onTime } = mocks.play.mock.calls[0][3];
  onTime(1.2);
  expect(video.currentTime).toBe(1.2);
  onTime(1.25);
  expect(video.currentTime).toBe(1.2);
});

it("annule le téléchargement et ignore un décodage terminé après le retrait du meme", async () => {
  let decoded!: (buffer: unknown) => void;
  mocks.decode.mockReturnValue(new Promise((resolve) => { decoded = resolve; }));
  stop = playMemeVideo(video, "blob:meme", 1, 10);
  await flush();
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  stop(); stop = undefined;
  decoded({ duration: 2 });
  await flush();
  expect(signal.aborted).toBe(true);
  expect(mocks.play).not.toHaveBeenCalled();
  expect(visual).not.toHaveBeenCalled();
  expect(video.hasAttribute("src")).toBe(false);
});

it("arrête le son créé pendant une ouverture native en attente", async () => {
  let ready!: () => void;
  mocks.play.mockReturnValue({ ready: new Promise<void>((resolve) => { ready = resolve; }), stop: mocks.stop });
  stop = playMemeVideo(video, "blob:meme", 1, 10);
  await flush();
  stop(); stop = undefined;
  ready();
  await flush();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(visual).not.toHaveBeenCalled();
});

it("affiche une vidéo sans piste audio sans sortie sonore du WebView", async () => {
  mocks.decode.mockRejectedValue(new Error("No audio track"));
  stop = playMemeVideo(video, "blob:meme", 1, 10);
  await flush();
  expect(visual).toHaveBeenCalledOnce();
  expect(video.muted).toBe(true);
  expect(mocks.play).not.toHaveBeenCalled();
});

it("ne décode pas de son quand le volume est nul", async () => {
  stop = playMemeVideo(video, "blob:meme", 0, 10);
  await flush();
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(visual).toHaveBeenCalledOnce();
});
