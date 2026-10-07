import { afterEach, expect, it, vi } from "vitest";

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(true),
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("./matrixService", () => ({ getMatrixClient: () => null }));
import { registerNativeVideoSurface } from "./voiceNativeService";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("perce la surface sous le panneau CSS, même entre les cinq points de contrôle", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.stubGlobal("ResizeObserver", class {
    observe() {} unobserve() {} disconnect() {}
  });
  const originalStyle = window.getComputedStyle.bind(window);
  vi.stubGlobal("getComputedStyle", (e: Element) => new Proxy(originalStyle(e), {
    get: (s, key) => Reflect.get(s, key) || (
      key === "position" ? "static" : key === "overflowX" || key === "overflowY" ? "visible"
        : key === "transform" || key === "filter" ? "none" : ""
    ),
  }));
  const parent = document.createElement("div");
  const canvas = document.createElement("canvas");
  const panneau = document.createElement("aside");
  panneau.className = "sion-panneau";
  const css = document.createElement("style");
  css.textContent = ".sion-panneau { position: absolute; }";
  parent.append(canvas);
  document.body.append(css, parent, panneau);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 500));
  vi.spyOn(panneau, "getBoundingClientRect").mockReturnValue(new DOMRect(900, 0, 40, 500));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value:
    (x: number) => !document.fullscreenElement && panneau.isConnected && x >= 900 && x <= 940 ? panneau : canvas });
  const retirer = await registerNativeVideoSurface(canvas, "partage");
  try {
    await vi.advanceTimersByTimeAsync(1);
    const surfaces = () => invoke.mock.calls.filter(([command]) => command === "native_video_surfaces_set").at(-1)?.[1].surfaces;
    expect(surfaces()).toEqual([expect.objectContaining({
      width: 1000, height: 500, holes: [{ x: 900, y: 0, width: 40, height: 500 }],
    })]);
    // Un panneau hors de la couche plein écran ne doit pas trouer le lecteur.
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: parent });
    await vi.advanceTimersByTimeAsync(250);
    expect(surfaces()[0].holes).toEqual([]);
  } finally {
    retirer();
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
  }
});
