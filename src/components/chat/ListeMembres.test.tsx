import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { ListeMembres } from "./ListeMembres";

const vue = montage();
let frames: FrameRequestCallback[];
let resize: (() => void) | undefined;

beforeEach(() => {
  frames = [];
  resize = undefined;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(162);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(256);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const parent = this.closest<HTMLElement>(".sion-membres-groupes");
    return { top: this.classList.contains("sion-membres-liste") ? -(parent?.scrollTop ?? 0) : 0,
      left: 0, right: 256, bottom: 162, width: 256, height: 162, x: 0, y: 0, toJSON() {} };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const afficher = (nombre = 700) => vue.render(<div className="sion-membres-groupes">
  <ListeMembres elements={Array.from({ length: nombre }, (_, i) => i)} render={(i) => <div key={i} data-membre={i}>Membre {i}</div>} />
</div>);
const monterFrames = async () => { await act(async () => { const callbacks = frames.splice(0); callbacks.forEach(f => f(0)); }); };
const membres = () => Array.from(vue.container.querySelectorAll('[data-membre]')).map(e => Number(e.getAttribute('data-membre')));

it("garde les petits groupes entiers et limite le rendu d'un grand espace", async () => {
  await afficher(5);
  expect(membres()).toEqual([0, 1, 2, 3, 4]);
  await afficher();
  expect(membres()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(vue.container.querySelector<HTMLElement>('.sion-membres-espace')?.style.height).toBe(`${693 * 54}px`);
});

it("rejoint les derniers membres au défilement sans monter les 700 lignes", async () => {
  await afficher();
  const parent = vue.container.querySelector<HTMLElement>('.sion-membres-groupes')!;
  parent.scrollTop = 697 * 54;
  await act(async () => parent.dispatchEvent(new Event('scroll')));
  await monterFrames();
  expect(membres()).toEqual([693, 694, 695, 696, 697, 698, 699]);
  expect(vue.container.querySelector<HTMLElement>('.sion-membres-espace')?.style.height).toBe(`${693 * 54}px`);
});

it("s'adapte au défilement des colonnes et à la rangée compacte horizontale", async () => {
  await afficher();
  const liste = vue.container.querySelector<HTMLElement>('.sion-membres-liste')!;
  liste.style.overflowY = 'auto';
  liste.style.setProperty('--sion-membre-pas', '48px');
  liste.scrollTop = 200 * 48;
  await act(async () => liste.dispatchEvent(new Event('scroll')));
  await monterFrames();
  expect(membres()[0]).toBe(196);
  expect(membres().at(-1)).toBe(207);
  liste.style.overflowY = 'hidden';
  liste.style.overflowX = 'auto';
  liste.style.display = 'flex';
  liste.style.columnGap = '4px';
  liste.style.setProperty('--sion-membre-pas', '128px');
  liste.scrollLeft = 500 * 128;
  resize?.();
  await monterFrames();
  expect(membres()[0]).toBe(496);
  expect(membres().at(-1)).toBe(505);
  expect(vue.container.querySelector<HTMLElement>('.sion-membres-espace')?.style.width).toBe(`${496 * 128 - 4}px`);
});

it("réduit correctement la fenêtre quand le groupe se vide", async () => {
  await afficher();
  const parent = vue.container.querySelector<HTMLElement>('.sion-membres-groupes')!;
  parent.scrollTop = 697 * 54;
  await act(async () => parent.dispatchEvent(new Event('scroll')));
  await monterFrames();
  await afficher(2);
  expect(membres()).toEqual([0, 1]);
  expect(vue.container.querySelector('.sion-membres-espace')).toBeNull();
});
