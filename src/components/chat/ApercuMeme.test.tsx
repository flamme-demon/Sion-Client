import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { ApercuMeme } from "./ApercuMeme";
const mock = vi.hoisted(() => ({ figer: vi.fn() }));
vi.mock("../../services/memePreview", () => ({ figerApercuMeme: mock.figer }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const vue = montage();
const creer = vi.fn(), revoquer = vi.fn(), fermerObservateur = vi.fn();
let observer: (visible: boolean) => void;
let numero = 0;
beforeEach(() => {
  numero = 0;
  mock.figer.mockReset().mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  creer.mockReset().mockImplementation(() => `blob:static-${++numero}`); revoquer.mockReset(); fermerObservateur.mockReset();
  vi.stubGlobal("URL", { createObjectURL: creer, revokeObjectURL: revoquer });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { observer = (visible) => callback([{ isIntersecting: visible }]); }
    observe() {}
    disconnect() { fermerObservateur(); }
  });
});
afterEach(() => vi.restoreAllMocks());
const rendreVisible = (visible: boolean) => act(async () => observer(visible));
it("garde la même image fixe après survol sans canvas affiché ni nouveau décodage", async () => {
  await vue.render(<ApercuMeme src="sion-media://localhost/meme" anime={false} />);
  expect(mock.figer).not.toHaveBeenCalled();
  await rendreVisible(true);
  expect(vue.container.querySelector("img")?.getAttribute("src")).toBe("blob:static-1");
  expect(vue.container.querySelector("canvas")).toBeNull();
  await vue.render(<ApercuMeme src="sion-media://localhost/meme" anime />);
  expect(Array.from(vue.container.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(["blob:static-1", "sion-media://localhost/meme"]);
  await vue.render(<ApercuMeme src="sion-media://localhost/meme" anime={false} />);
  expect(vue.container.querySelector("img")?.getAttribute("src")).toBe("blob:static-1");
  expect(mock.figer).toHaveBeenCalledTimes(1); expect(revoquer).not.toHaveBeenCalled();
});
it("libère les images hors écran puis les recrée au retour, sans croissance des URL", async () => {
  await vue.render(<ApercuMeme src="https://media.test/meme.webp" anime={false} />);
  for (let i = 0; i < 24; i++) {
    await rendreVisible(true);
    expect(vue.container.querySelectorAll("img")).toHaveLength(1);
    await rendreVisible(false);
    expect(vue.container.querySelector("img")).toBeNull();
    expect(revoquer).toHaveBeenCalledTimes(i + 1);
  }
  await vue.render(null);
  expect(fermerObservateur).toHaveBeenCalledTimes(1);
  expect(creer).toHaveBeenCalledTimes(24); expect(revoquer).toHaveBeenCalledTimes(24);
});
it("ignore le résultat tardif d'un aperçu après changement de source", async () => {
  let terminer!: (blob: Blob) => void;
  mock.figer.mockReturnValueOnce(new Promise((resolve) => { terminer = resolve; }));
  await vue.render(<ApercuMeme src="https://media.test/avant.webp" anime={false} />); await rendreVisible(true);
  const signal = mock.figer.mock.calls[0][1] as AbortSignal;
  await vue.render(<ApercuMeme src="https://media.test/apres.webp" anime={false} />);
  expect(signal.aborted).toBe(true);
  await act(async () => terminer(new Blob(["ancien"])));
  expect(creer).toHaveBeenCalledTimes(1);
  expect(vue.container.querySelector("img")?.getAttribute("src")).toBe("blob:static-1");
});
it("propose une reprise visible sans déclencher le mème après une erreur", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mock.figer.mockRejectedValueOnce(new Error("decode failed"));
  const lancer = vi.fn();
  await vue.render(<div onClick={lancer}><ApercuMeme src="https://media.test/meme.webp" anime={false} /></div>); await rendreVisible(true);
  await vue.click('[aria-label="memeboard.retryPreview"]');
  expect(lancer).not.toHaveBeenCalled();
  expect(vue.container.querySelector("img")?.getAttribute("src")).toBe("blob:static-1");
});
it("annule une préparation à la fermeture sans créer d'URL tardive", async () => {
  let terminer!: (blob: Blob) => void;
  mock.figer.mockReturnValueOnce(new Promise((resolve) => { terminer = resolve; }));
  await vue.render(<ApercuMeme src="https://media.test/meme.webp" anime={false} />); await rendreVisible(true);
  const signal = mock.figer.mock.calls[0][1] as AbortSignal;
  await vue.render(null);
  await act(async () => terminer(new Blob(["png"])));
  expect(signal.aborted).toBe(true); expect(creer).not.toHaveBeenCalled(); expect(fermerObservateur).toHaveBeenCalledTimes(1);
});
