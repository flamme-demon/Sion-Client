import { expect, it, vi } from "vitest";
import type { VoiceNativeBinaryFrame } from "./voiceNativeService";

const mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("./voiceNativeService", () => ({ connectVoiceNativeVideoStream: mock.connect }));
import { subscribeVideoFrames } from "./videoFramesService";

it("partage le transport entre caméra et écran du même participant et libère le dernier lecteur", async () => {
  let deliver!: (frame: VoiceNativeBinaryFrame) => void;
  const close = vi.fn();
  mock.connect.mockImplementation(async (callback) => { deliver = callback; return close; });
  const camera = vi.fn(), screen = vi.fn();
  const stopCamera = subscribeVideoFrames("camera:@alice:test", camera);
  const stopScreen = subscribeVideoFrames("@alice:test", screen);
  await Promise.resolve(); await Promise.resolve();
  expect(mock.connect).toHaveBeenCalledOnce();
  const frame = { sender: "camera:@alice:test", width: 1, height: 1, jpeg: new Uint8Array([1]), receivedAt: 1 };
  deliver(frame);
  expect(camera).toHaveBeenCalledWith(frame);
  expect(screen).not.toHaveBeenCalled();
  stopCamera(); stopCamera();
  expect(close).not.toHaveBeenCalled();
  deliver({ ...frame, sender: "@alice:test" });
  expect(screen).toHaveBeenCalledOnce();
  stopScreen();
  expect(close).toHaveBeenCalledOnce();
});

it("une connexion arrivée après la fermeture de la fenêtre est immédiatement libérée", async () => {
  await Promise.resolve(); await Promise.resolve();
  let resolve!: (close: () => void) => void;
  mock.connect.mockReturnValue(new Promise<() => void>((ready) => { resolve = ready; }));
  const stop = subscribeVideoFrames("camera:@bob:test", vi.fn());
  stop();
  const close = vi.fn();
  resolve(close);
  await Promise.resolve(); await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
});
