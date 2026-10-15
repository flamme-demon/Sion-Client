import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("décode dans un contexte hors ligne réutilisé sans ouvrir de sortie audio", async () => {
  const live = vi.fn();
  const offline = vi.fn(class { decodeAudioData = vi.fn(); });
  vi.stubGlobal("AudioContext", live);
  vi.stubGlobal("OfflineAudioContext", offline);
  const { getSharedAudioContext } = await import("./audioContext");
  const first = getSharedAudioContext();
  expect(getSharedAudioContext()).toBe(first);
  expect(offline).toHaveBeenCalledExactlyOnceWith(2, 1, 48_000);
  expect(live).not.toHaveBeenCalled();
});
