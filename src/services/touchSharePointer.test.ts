import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachTouchSharePointer } from "./touchSharePointer";
import { broadcastCursor, broadcastCursorClick, broadcastCursorHide } from "./cursorService";

vi.mock("./cursorService", () => ({
  broadcastCursor: vi.fn(), broadcastCursorClick: vi.fn(), broadcastCursorHide: vi.fn(),
}));

describe("pointage tactile du partage", () => {
  let canvas: HTMLCanvasElement;
  let cleanup: () => void;
  let clock: number;
  const markPointed = vi.fn();
  const event = (type: string, x: number, y: number, extras: Record<string, unknown> = {}) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperties(e, Object.fromEntries(Object.entries({
      pointerType: "touch", pointerId: 1, isPrimary: true, ...extras,
    }).map(([key, value]) => [key, { value }])));
    canvas.dispatchEvent(e);
    return e;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    cleanup = attachTouchSharePointer(canvas, {
      target: "alice", contentRect: () => ({ left: 100, top: 200, width: 400, height: 200 }), markPointed,
    });
  });
  afterEach(() => { cleanup(); canvas.remove(); vi.restoreAllMocks(); });

  it("normalise le doigt sur l'image, émet une onde au relâchement puis masque le curseur", () => {
    expect(event("pointerdown", 300, 300).defaultPrevented).toBe(true);
    expect(broadcastCursor).toHaveBeenCalledWith(0.5, 0.5, "alice");
    expect(markPointed).toHaveBeenCalledWith("alice");
    event("pointerup", 300, 300);
    expect(broadcastCursorClick).toHaveBeenCalledWith(0.5, 0.5, "alice");
    expect(broadcastCursorHide).toHaveBeenCalledWith("alice");
  });

  it("suit un glissement sans le confondre avec un clic, avec une cadence bornée", () => {
    event("pointerdown", 300, 300);
    clock += 5;
    event("pointermove", 320, 310);
    expect(broadcastCursor).toHaveBeenCalledTimes(1);
    clock += 20;
    event("pointermove", 400, 350);
    expect(broadcastCursor).toHaveBeenLastCalledWith(0.75, 0.75, "alice");
    event("pointerup", 400, 350);
    expect(broadcastCursorClick).not.toHaveBeenCalled();
    expect(broadcastCursorHide).toHaveBeenCalledOnce();
  });

  it("ignore les bandes noires et masque immédiatement une sortie de l'image", () => {
    event("pointerdown", 300, 150);
    expect(broadcastCursor).not.toHaveBeenCalled();
    clock += 20;
    event("pointermove", 300, 300);
    expect(broadcastCursor).toHaveBeenCalledOnce();
    event("pointermove", 300, 450);
    expect(broadcastCursorHide).toHaveBeenCalledOnce();
    event("pointerup", 300, 450);
    expect(broadcastCursorClick).not.toHaveBeenCalled();
  });

  it.each(["pointercancel", "lostpointercapture"])("nettoie %s sans onde", (type) => {
    event("pointerdown", 300, 300);
    event(type, 300, 300);
    event("pointerup", 300, 300);
    expect(broadcastCursorHide).toHaveBeenCalledOnce();
    expect(broadcastCursorClick).not.toHaveBeenCalled();
  });

  it("laisse la souris et les doigts secondaires à leurs gestionnaires", () => {
    event("pointerdown", 300, 300, { pointerType: "mouse" });
    event("pointerdown", 300, 300, { isPrimary: false, pointerId: 2 });
    expect(broadcastCursor).not.toHaveBeenCalled();
  });

  it("absorbe le clic synthétique tactile sans bloquer les prochains clics souris", () => {
    const handler = vi.fn();
    canvas.addEventListener("click", handler);
    event("pointerdown", 300, 300);
    event("pointerup", 300, 300);
    expect(event("click", 300, 300).defaultPrevented).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    clock += 1000;
    event("click", 300, 300, { pointerType: "mouse" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("supprime les écouteurs et tout curseur lors du démontage", () => {
    event("pointerdown", 300, 300);
    cleanup();
    expect(broadcastCursorHide).toHaveBeenCalledOnce();
    clock += 20;
    event("pointermove", 400, 350);
    expect(broadcastCursor).toHaveBeenCalledOnce();
  });

  it("permet de sélectionner une tuile au toucher mais pas après un glissement", () => {
    cleanup();
    cleanup = attachTouchSharePointer(canvas, {
      target: "alice", contentRect: () => ({ left: 100, top: 200, width: 400, height: 200 }),
      markPointed, suppressClick: false,
    });
    const select = vi.fn();
    canvas.addEventListener("click", select);
    event("pointerdown", 300, 300);
    event("pointerup", 300, 300);
    event("click", 300, 300);
    expect(select).toHaveBeenCalledOnce();
    clock += 1000;
    event("pointerdown", 300, 300);
    clock += 20;
    event("pointermove", 400, 300);
    event("pointerup", 400, 300);
    event("click", 400, 300);
    expect(select).toHaveBeenCalledOnce();
  });

  it("masque un doigt interrompu par un changement d'application", () => {
    event("pointerdown", 300, 300);
    window.dispatchEvent(new Event("blur"));
    event("pointerup", 300, 300);
    expect(broadcastCursorHide).toHaveBeenCalledOnce();
    expect(broadcastCursorClick).not.toHaveBeenCalled();
  });
});
