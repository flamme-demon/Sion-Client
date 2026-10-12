import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialiserDemarrage, terminerDemarrage } from "./demarrage";

let mobile = false;
let reduit: MediaQueryList;
let cache = false;
const jouer = vi.fn().mockResolvedValue(undefined);
const pause = vi.fn();
const charger = vi.fn();
const cadre = () => document.getElementById("sion-demarrage")!;
const video = () => cadre().querySelector("video")!;

beforeEach(() => {
  vi.useFakeTimers();
  mobile = false; cache = false;
  jouer.mockReset().mockResolvedValue(undefined); pause.mockClear(); charger.mockClear();
  reduit = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  vi.stubGlobal("matchMedia", (q: string) => q.includes("reduced") ? reduit : { matches: mobile });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => window.setTimeout(() => fn(performance.now()), 1));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => cache);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(jouer);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(charger);
  document.body.innerHTML = '<div id="sion-demarrage"><picture><img alt="" /></picture><video></video></div><main>Interface prête</main>';
});
afterEach(() => {
  terminerDemarrage(); vi.runAllTimers();
  document.body.innerHTML = "";
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("lance seulement la vidéo ordinateur, silencieuse, pendant le chargement", () => {
  initialiserDemarrage();
  expect(video().getAttribute("src")).toBe("/branding/demarrage-desktop.mp4");
  expect(video().muted).toBe(true);
  expect(video().playsInline).toBe(true);
  expect(jouer).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(6000);
  expect(cadre()).not.toBeNull();
});

it("sélectionne la vidéo portrait sur mobile", () => {
  mobile = true; initialiserDemarrage();
  expect(video().getAttribute("src")).toBe("/branding/demarrage-mobile.mp4");
});

it("rend l'interface utilisable immédiatement puis libère le lecteur sans attendre la fin du clip", () => {
  initialiserDemarrage(); const lecteur = video();
  terminerDemarrage();
  expect(cadre().style.pointerEvents).toBe("none");
  vi.advanceTimersByTime(1);
  expect(cadre().dataset.termine).toBe("true");
  vi.advanceTimersByTime(180);
  expect(document.getElementById("sion-demarrage")).toBeNull();
  expect(lecteur.hasAttribute("src")).toBe(false);
  expect(pause).toHaveBeenCalledOnce();
  expect(charger).toHaveBeenCalledOnce();
  const appels = pause.mock.calls.length;
  document.dispatchEvent(new Event("visibilitychange"));
  reduit.dispatchEvent(new Event("change"));
  expect(pause.mock.calls.length).toBe(appels);
});

it("garde le poster lorsque la lecture automatique est refusée", async () => {
  jouer.mockRejectedValueOnce(new DOMException("Refusée", "NotAllowedError"));
  initialiserDemarrage(); await Promise.resolve();
  expect(cadre().dataset.videoPrete).toBeUndefined();
  expect(cadre().querySelector("picture")).not.toBeNull();
});

it("revient à l'image fixe et libère la vidéo en cas d'erreur de décodage", () => {
  initialiserDemarrage(); const lecteur = video();
  lecteur.dispatchEvent(new Event("playing"));
  expect(cadre().dataset.videoPrete).toBe("true");
  lecteur.dispatchEvent(new Event("error"));
  expect(cadre().dataset.videoPrete).toBeUndefined();
  expect(lecteur.hasAttribute("src")).toBe(false);
});

it("ne charge aucune vidéo lorsque les animations sont réduites", () => {
  Object.assign(reduit, { matches: true }); initialiserDemarrage();
  expect(video().hasAttribute("src")).toBe(false);
  expect(jouer).not.toHaveBeenCalled();
  terminerDemarrage();
  expect(document.getElementById("sion-demarrage")).toBeNull();
});

it("arrête l'animation si la préférence système change", () => {
  initialiserDemarrage(); video().dispatchEvent(new Event("playing"));
  Object.assign(reduit, { matches: true }); reduit.dispatchEvent(new Event("change"));
  expect(video().hasAttribute("src")).toBe(false);
  expect(cadre().dataset.videoPrete).toBeUndefined();
});

it("met en pause en arrière-plan et ne rejoue pas un clip terminé au retour", () => {
  initialiserDemarrage(); const lecteur = video();
  cache = true; document.dispatchEvent(new Event("visibilitychange"));
  expect(pause).toHaveBeenCalledOnce();
  cache = false; document.dispatchEvent(new Event("visibilitychange"));
  expect(jouer).toHaveBeenCalledTimes(2);
  vi.spyOn(lecteur, "ended", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(jouer).toHaveBeenCalledTimes(2);
});

it("ne double ni la lecture ni la fermeture et ne crée rien après le démarrage", () => {
  initialiserDemarrage(); initialiserDemarrage();
  expect(jouer).toHaveBeenCalledOnce();
  terminerDemarrage(); terminerDemarrage(); vi.runAllTimers();
  initialiserDemarrage(); terminerDemarrage();
  expect(jouer).toHaveBeenCalledOnce(); expect(charger).toHaveBeenCalledOnce();
});
