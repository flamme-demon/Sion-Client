import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { toggleShareFullscreen } from "./shareFullscreen";

describe("plein écran des partages", () => {
  let page: Document;
  let frame: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let clock: number;
  let fullscreen: Element | null;
  let request: Mock<() => Promise<void>>;
  let exit: Mock<() => Promise<void>>;

  beforeEach(() => {
    page = document.implementation.createHTMLDocument();
    frame = page.createElement("div");
    canvas = page.createElement("canvas");
    frame.append(canvas);
    page.body.append(frame);
    clock = 1000;
    fullscreen = null;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    Object.defineProperty(page, "fullscreenElement", { get: () => fullscreen });
    request = vi.fn(async () => { fullscreen = frame; });
    exit = vi.fn(async () => { fullscreen = null; });
    frame.requestFullscreen = request;
    page.exitFullscreen = exit;
  });

  afterEach(() => vi.restoreAllMocks());

  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

  it("demande immédiatement le cadre entier pendant l'activation du clic", async () => {
    toggleShareFullscreen(canvas);
    expect(request).toHaveBeenCalledOnce();
    expect(fullscreen).toBe(frame);
    await settle();
    clock += 500;
    toggleShareFullscreen(canvas);
    expect(exit).toHaveBeenCalledOnce();
    await settle();
  });

  it.each([2, 3, 4])("absorbe une rafale de %i clics sans programmer de bascule différée", async (count) => {
    toggleShareFullscreen(canvas);
    await settle();
    for (let click = 1; click < count; click++) {
      clock += 200;
      toggleShareFullscreen(canvas);
      await settle();
    }
    expect(request).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    clock += 1000;
    await settle();
    expect(exit).not.toHaveBeenCalled();
    toggleShareFullscreen(canvas);
    expect(exit).toHaveBeenCalledOnce();
    await settle();
  });

  it("ignore une autre tuile et la barre tant que la transition n'est pas terminée", async () => {
    let finish!: () => void;
    request.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const otherFrame = page.createElement("div");
    const otherCanvas = page.createElement("canvas");
    const otherRequest = vi.fn().mockResolvedValue(undefined);
    otherFrame.requestFullscreen = otherRequest;
    otherFrame.append(otherCanvas);
    page.body.append(otherFrame);
    toggleShareFullscreen(canvas);
    clock += 2000;
    toggleShareFullscreen(otherCanvas);
    toggleShareFullscreen(canvas);
    expect(request).toHaveBeenCalledOnce();
    expect(otherRequest).not.toHaveBeenCalled();
    finish();
    await settle();
    clock += 500;
    toggleShareFullscreen(otherCanvas);
    expect(otherRequest).toHaveBeenCalledOnce();
    await settle();
  });

  it("reste utilisable après un refus d'activation", async () => {
    const failure = new TypeError("Cannot request fullscreen without transient activation.");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    request.mockRejectedValueOnce(failure);
    toggleShareFullscreen(canvas);
    await settle();
    expect(warning).toHaveBeenCalledWith("[Sion] requestFullscreen failed:", failure);
    clock += 500;
    toggleShareFullscreen(canvas);
    expect(request).toHaveBeenCalledTimes(2);
    await settle();
  });

  it("libère aussi la transition si l'API lève une erreur synchrone", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    request.mockImplementationOnce(() => { throw new TypeError("Fullscreen unavailable"); });
    expect(() => toggleShareFullscreen(canvas)).not.toThrow();
    clock += 500;
    toggleShareFullscreen(canvas);
    expect(request).toHaveBeenCalledTimes(2);
    await settle();
  });

  it("suit la sortie par Échap sans mémoriser un faux état plein écran", async () => {
    toggleShareFullscreen(canvas);
    await settle();
    fullscreen = null;
    page.dispatchEvent(new Event("fullscreenchange"));
    clock += 500;
    toggleShareFullscreen(canvas);
    expect(request).toHaveBeenCalledTimes(2);
    expect(exit).not.toHaveBeenCalled();
    await settle();
  });

  it("ignore une vue démontée", () => {
    frame.remove();
    toggleShareFullscreen(canvas);
    expect(request).not.toHaveBeenCalled();
  });
});
