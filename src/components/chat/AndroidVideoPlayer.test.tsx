import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileAttachment } from "../../types/matrix";
import { AndroidVideoPlayer } from "./AndroidVideoPlayer";
import { definirLecteurActif } from "../../services/lecteurActif";

const resolveUrl = vi.hoisted(() => vi.fn());
const decrypt = vi.hoisted(() => vi.fn());
const leases = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock("../../services/matrixCore", () => ({ urlLecture: resolveUrl, retenirMediaLecture: leases.acquire, libererMediaLecture: leases.release }));
vi.mock("../../utils/decryptMedia", () => ({ createDecryptedObjectUrl: decrypt }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  definirLecteurActif(null);
  resolveUrl.mockReset();
  decrypt.mockReset();
  leases.acquire.mockReset().mockResolvedValue(17);
  leases.release.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: vi.fn() }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function attachment(url: string, extra: Partial<FileAttachment> = {}): FileAttachment {
  return { id: url, url, name: "Video.mp4", size: 6_000_000, mimeType: "video/mp4", ...extra };
}
async function render(file: FileAttachment) {
  await act(async () => root.render(<AndroidVideoPlayer attachment={file} ratio="9 / 16" />));
}
async function start(index = 0) {
  await act(async () => (container.querySelectorAll('[aria-label="chat.play"]')[index] as HTMLButtonElement).click());
}

it("ne télécharge aucune vidéo à l'ouverture d'un fil, même avec de nombreuses cartes", async () => {
  await act(async () => root.render(<>{Array.from({ length: 100 }, (_, index) =>
    <AndroidVideoPlayer key={index} attachment={attachment(`sion-media://localhost/${index}`)} ratio="16 / 9" />
  )}</>));
  expect(resolveUrl).not.toHaveBeenCalled();
  expect(leases.acquire).not.toHaveBeenCalled();
  expect(decrypt).not.toHaveBeenCalled();
  expect(container.querySelectorAll("video")).toHaveLength(0);
  expect(container.querySelectorAll('[aria-label="chat.play"]')).toHaveLength(100);
});

it("charge et joue au clic, avec le son actif, sans demande d'aperçu vidéo", async () => {
  let finish!: (url: string) => void;
  resolveUrl.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
  await render(attachment("http://sion-media.localhost/00ff00ff00ff00ff"));
  await start();
  expect(container.querySelector("video")).toBeNull();
  await act(async () => finish("http://127.0.0.1:41234/matrix/00ff00ff00ff00ff"));
  const video = container.querySelector("video")!;
  expect(video.src).toBe("http://127.0.0.1:41234/matrix/00ff00ff00ff00ff");
  expect(video.preload).toBe("none");
  expect(video.muted).toBe(false);
  expect(video.controls).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(video.play).toHaveBeenCalledOnce();
});

it("ignore une résolution tardive quand la carte change de fichier", async () => {
  let finishOld!: (url: string) => void;
  resolveUrl.mockReturnValueOnce(new Promise<string>((resolve) => { finishOld = resolve; }));
  await render(attachment("sion-media://localhost/aaaaaaaaaaaaaaaa"));
  await start();
  resolveUrl.mockResolvedValueOnce("http://127.0.0.1:41234/matrix/bbbbbbbbbbbbbbbb");
  await render(attachment("sion-media://localhost/bbbbbbbbbbbbbbbb"));
  await start();
  await act(async () => finishOld("http://127.0.0.1:41234/matrix/aaaaaaaaaaaaaaaa"));
  expect(container.querySelector("video")!.src).toContain("/bbbbbbbbbbbbbbbb");
});

it("diffère le déchiffrement au clic et libère le blob à la fermeture", async () => {
  decrypt.mockResolvedValue("blob:decrypted-video");
  const file = attachment("https://example.test/encrypted", { thumbnailUrl: "https://example.test/poster.jpg", encryptedFile: {
    url: "mxc://hs/video", iv: "iv", hashes: { sha256: "hash" }, v: "v2",
    key: { alg: "A256CTR", key_ops: ["decrypt"], kty: "oct", k: "key", ext: true },
  } });
  await render(file);
  expect(decrypt).not.toHaveBeenCalled();
  await start();
  expect(decrypt).toHaveBeenCalledWith(file.url, file.encryptedFile, file.mimeType);
  expect(resolveUrl).not.toHaveBeenCalled();
  expect(container.querySelector("video")!.src).toBe("blob:decrypted-video");
  expect(container.querySelector("video")!.poster).toBe(file.thumbnailUrl);
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("video")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:decrypted-video");
  expect(leases.acquire).not.toHaveBeenCalled();
});

it("signale un serveur indisponible et permet une nouvelle tentative", async () => {
  resolveUrl.mockResolvedValueOnce(null);
  await render(attachment("sion-media://localhost/aaaaaaaaaaaaaaaa"));
  await start();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("chat.videoPlayFailed");
  resolveUrl.mockResolvedValueOnce("http://127.0.0.1:41234/matrix/aaaaaaaaaaaaaaaa");
  await act(async () => container.querySelector('[role="alert"] button')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(container.querySelector("video")).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("signale un échec du décodeur sans boucle de rechargement automatique", async () => {
  resolveUrl.mockResolvedValue("http://127.0.0.1:41234/matrix/aaaaaaaaaaaaaaaa");
  await render(attachment("sion-media://localhost/aaaaaaaaaaaaaaaa"));
  await start();
  await act(async () => container.querySelector("video")!.dispatchEvent(new Event("error")));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(resolveUrl).toHaveBeenCalledOnce();
});

it("libère le précédent décodeur même si la même pièce jointe apparaît deux fois", async () => {
  resolveUrl.mockResolvedValue("http://127.0.0.1:41234/matrix/aaaaaaaaaaaaaaaa");
  const file = attachment("sion-media://localhost/aaaaaaaaaaaaaaaa");
  await act(async () => root.render(<>
    <AndroidVideoPlayer attachment={file} ratio="9 / 16" />
    <AndroidVideoPlayer attachment={file} ratio="9 / 16" />
  </>));
  await start();
  const first = container.querySelector("video")!;
  await start();
  expect(container.querySelectorAll("video")).toHaveLength(1);
  expect(container.querySelector("video")).not.toBe(first);
  expect(first.isConnected).toBe(false);
  expect(first.hasAttribute("src")).toBe(false);
  expect(first.pause).toHaveBeenCalled();
  expect(first.load).toHaveBeenCalled();
  expect(leases.release).toHaveBeenCalledWith(17);
});

it("libère le lecteur à la fin et garde la carte prête pour une nouvelle lecture", async () => {
  resolveUrl.mockResolvedValue("http://127.0.0.1:41234/matrix/aaaaaaaaaaaaaaaa");
  await render(attachment("sion-media://localhost/aaaaaaaaaaaaaaaa"));
  await start();
  await act(async () => container.querySelector("video")!.dispatchEvent(new Event("ended")));
  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelector('[aria-label="chat.play"]')).not.toBeNull();
  expect(leases.release).toHaveBeenCalledWith(17);
});

it("libère un bail arrivé après la fermeture de la carte", async () => {
  let finish!: (id: number) => void;
  leases.acquire.mockReturnValueOnce(new Promise<number>((resolve) => { finish = resolve; }));
  await render(attachment("sion-media://localhost/aaaaaaaaaaaaaaaa"));
  await start();
  await act(async () => container.querySelector("button")!.click());
  await act(async () => finish(41));
  expect(leases.release).toHaveBeenCalledWith(41);
  expect(resolveUrl).not.toHaveBeenCalled();
  expect(container.querySelector("video")).toBeNull();
});
