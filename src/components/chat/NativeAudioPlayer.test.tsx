import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ play: vi.fn(), decode: vi.fn(), stop: vi.fn(), gain: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../services/audioContext", () => ({ getSharedAudioContext: () => ({ decodeAudioData: mocks.decode }) }));
vi.mock("../../services/nativeAudioPlayback", () => ({ playNativeBuffer: mocks.play }));
import { NativeAudioPlayer } from "./NativeAudioPlayer";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.play.mockReturnValue({ ready: Promise.resolve(), stop: mocks.stop, setGain: mocks.gain });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("lecture, pause et démontage utilisent le lecteur natif sans balise audio", async () => {
  const buffer = { duration: 30 };
  mocks.decode.mockResolvedValue(buffer);
  await act(async () => { root.render(<NativeAudioPlayer source="blob:audio" />); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { container.querySelector("button")!.click(); });
  expect(mocks.play).toHaveBeenCalledWith(buffer, 0, 30, expect.objectContaining({ gain: 1, allowDeafened: true }));
  expect(container.querySelector("audio")).toBeNull();
  await act(async () => { container.querySelector("button")!.click(); });
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("une pièce jointe retirée pendant le décodage ne démarre pas tardivement", async () => {
  let resolve!: (buffer: unknown) => void;
  mocks.decode.mockReturnValue(new Promise((r) => { resolve = r; }));
  await act(async () => { root.render(<NativeAudioPlayer source="blob:audio" />); });
  await act(async () => { container.querySelector("button")!.click(); });
  await act(async () => { root.render(<div />); });
  await act(async () => { resolve({ duration: 30 }); });
  expect(mocks.play).not.toHaveBeenCalled();
});
