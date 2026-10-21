import { act } from "react";
import { expect, it, vi } from "vitest";
import { montage } from "../../test/interface";

const mocks = vi.hoisted(() => ({
  ouvrir: vi.fn(), fermer: vi.fn(), inscrire: vi.fn(), liberer: vi.fn(), seek: vi.fn(),
  volume: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../stores/useSettingsStore", () => {
  const state = { videoVolume: 1, setVideoVolume: vi.fn() };
  return { useSettingsStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) };
});
vi.mock("../../services/voiceNativeService", () => ({
  SENDER_LECTEUR: "sion:lecteur",
  ouvrirLecteurVideo: mocks.ouvrir,
  fermerLecteurVideo: mocks.fermer,
  registerNativeVideoSurface: mocks.inscrire,
  precharcherVideo: vi.fn().mockResolvedValue(undefined),
  volumeLecteurVideo: mocks.volume,
  zonesLecteurVideo: vi.fn().mockResolvedValue(null),
  resolutionLecteurVideo: vi.fn(),
  etatLecteurVideo: vi.fn(), pauseLecteurVideo: vi.fn(),
  apercuLecteurVideo: vi.fn(), seekLecteurVideo: mocks.seek,
}));
import { NativeVideoPlayer } from "./NativeVideoPlayer";

const vue = montage();

it("sort le mini-lecteur du fil contenu et conserve le canvas et la lecture au retour", async () => {
  vi.clearAllMocks();
  let intersection!: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: IntersectionObserverCallback) { intersection = cb; }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  mocks.inscrire.mockResolvedValue(mocks.liberer);
  mocks.ouvrir.mockResolvedValue({ actif: true, largeur: 1920, hauteur: 1080, duree_ms: 10_000, en_pause: false });
  vue.container.style.cssText = "overflow-y: auto; contain: strict; height: 400px";
  vi.spyOn(vue.container, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 200, 600, 400));
  const fermer = vi.fn();
  await vue.render(<NativeVideoPlayer source="clip.mp4" onClose={fermer} />);
  const canvas = vue.container.querySelector("canvas")!;
  const cadre = canvas.parentElement!;
  expect(canvas).not.toBeNull();

  const visibilite = async (ratio: number) => {
    await act(async () => intersection([{ intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver));
  };
  await visibilite(0.2);
  expect(document.body.contains(canvas)).toBe(true);
  expect(vue.container.contains(canvas)).toBe(false);
  expect(cadre.style.position).toBe("fixed");
  expect(cadre.style.right).toBe(`${window.innerWidth - 700 + 16}px`);
  expect(cadre.style.bottom).toBe(`${window.innerHeight - 600 + 16}px`);
  await visibilite(0.45);
  expect(vue.container.contains(canvas)).toBe(false);
  await visibilite(0.7);
  expect(vue.container.querySelector("canvas")).toBe(canvas);
  expect(cadre.style.position).toBe("relative");
  expect(mocks.ouvrir).toHaveBeenCalledOnce();
  expect(mocks.inscrire).toHaveBeenCalledOnce();
  expect(mocks.fermer).not.toHaveBeenCalled();
  expect(fermer).not.toHaveBeenCalled();
});

it("rejoint le curseur avant de rétablir le son et transmet sa position au découpeur", async () => {
  vi.clearAllMocks();
  mocks.inscrire.mockResolvedValue(mocks.liberer);
  const ouvert = { actif: true, largeur: 640, hauteur: 360, duree_ms: 20_000, position_ms: 0, en_pause: false, a_du_son: true };
  mocks.ouvrir.mockResolvedValue(ouvert);
  mocks.seek.mockResolvedValue({ ...ouvert, position_ms: 7_000 });
  const suivre = vi.fn();
  await vue.render(<NativeVideoPlayer source="clip.mp4" departMs={7_000} onClose={() => {}} onEtatChange={suivre} />);
  expect(mocks.seek).toHaveBeenCalledWith(7_000);
  expect(mocks.volume.mock.calls.map(([v]) => v)).toEqual([0, 1]);
  expect(mocks.volume.mock.invocationCallOrder[0]).toBeLessThan(mocks.ouvrir.mock.invocationCallOrder[0]);
  expect(mocks.seek.mock.invocationCallOrder[0]).toBeLessThan(mocks.volume.mock.invocationCallOrder[1]);
  expect(suivre).toHaveBeenLastCalledWith(expect.objectContaining({ position_ms: 7_000 }));
});
