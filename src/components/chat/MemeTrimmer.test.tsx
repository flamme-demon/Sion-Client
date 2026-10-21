import { act } from "react";
import { expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import type { EtatLecteurVideo } from "../../services/voiceNativeService";

const mocks = vi.hoisted(() => ({
  image: vi.fn().mockResolvedValue("image.jpg"), lecteur: vi.fn(),
  pause: vi.fn(), etat: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../services/memeboardService", () => ({
  MEME_DUREE_MAX_MS: 10_000, imageMeme: mocks.image, blobPrepare: vi.fn().mockResolvedValue(new Blob()),
}));
vi.mock("../../services/voiceNativeService", () => ({ etatLecteurVideo: mocks.etat, pauseLecteurVideo: mocks.pause }));
interface LecteurProps { source: string; departMs: number; onEtatChange: (etat: EtatLecteurVideo) => void }
vi.mock("./NativeVideoPlayer", () => ({ NativeVideoPlayer: (props: LecteurProps) => {
  mocks.lecteur(props);
  return <div data-lecteur="true" />;
} }));
import { MemeTrimmer } from "./MemeTrimmer";

const vue = montage();
const piste = (nom = "editorOverview") => vue.container.querySelector<HTMLElement>(`[role="group"][aria-label="memeboard.${nom}"]`)!;
const borne = (nom: "startFrame" | "endFrame", zoom = false) => piste(zoom ? "editorZoom" : "editorOverview").querySelector<HTMLElement>(`[title="memeboard.${nom}"]`)!;
const geometrie = (element: HTMLElement) => vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 50));
const pointer = async (cible: HTMLElement, type: string, x: number) => {
  await act(async () => cible.dispatchEvent(new MouseEvent(type, { clientX: x, bubbles: true })));
};
const clicBouton = async (texte: string) => {
  const bouton = [...vue.container.querySelectorAll("button")].find((b) => b.textContent?.includes(texte))!;
  expect(bouton).toBeDefined();
  await act(async () => bouton.click());
};
const etat = (position: number, pause = false): EtatLecteurVideo => ({ actif: true, largeur: 640, hauteur: 360, duree_ms: 20_000, position_ms: position, en_pause: pause, a_du_son: true });

it("propose la vue d'ensemble, le zoom et les bornes fixées au curseur", async () => {
  const changer = vi.fn();
  await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={20_000} onChange={changer} essai={null} onFinEssai={() => {}} />);
  expect(piste()).not.toBeNull();
  const zoom = piste("editorZoom");
  geometrie(zoom);
  expect([...vue.container.querySelectorAll("button")].filter((b) => b.textContent?.includes("editorFix")).every((b) => b.disabled)).toBe(true);
  await pointer(zoom, "pointerdown", 250); // 3,5 s dans la fenêtre 0–14 s
  await pointer(zoom, "pointerup", 250);
  expect(changer).not.toHaveBeenCalled();
  await clicBouton("editorFixStart");
  expect(changer).toHaveBeenLastCalledWith(3_500, 10_000);
  await pointer(zoom, "pointerdown", 500); // fenêtre recentrée 1,5–12 s : 6,75 s
  await pointer(zoom, "pointerup", 500);
  await clicBouton("editorFixEnd");
  expect(changer).toHaveBeenLastCalledWith(3_500, 6_750);
});

it("déplace toute la sélection depuis la vue d'ensemble en conservant sa durée", async () => {
  const changer = vi.fn();
  await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={20_000} onChange={changer} essai={null} onFinEssai={() => {}} />);
  geometrie(piste());
  const selection = piste().querySelector<HTMLElement>('[style*="cursor: grab"]')!;
  await pointer(selection, "pointerdown", 100);
  await pointer(selection, "pointermove", 350);
  await pointer(selection, "pointerup", 350);
  expect(changer).toHaveBeenLastCalledWith(5_000, 15_000);
});

it.each([10_000, 9_500])("réduit une sélection de %i ms sans déplacer le début, même par le bord de la poignée", async (longueur) => {
  const changer = vi.fn();
  await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={20_000} onChange={changer} essai={null} onFinEssai={() => {}} />);
  geometrie(piste());
  const selection = piste().querySelector<HTMLElement>('[style*="cursor: grab"]')!;
  await pointer(selection, "pointerdown", 100);
  await pointer(selection, "pointermove", 350);
  await pointer(selection, "pointerup", 350);
  if (longueur < 10_000) {
    await pointer(borne("endFrame"), "pointerdown", 750);
    await pointer(borne("endFrame"), "pointermove", 725);
    await pointer(borne("endFrame"), "pointerup", 725);
  }
  const centre = (5_000 + longueur) / 20;
  await pointer(borne("endFrame"), "pointerdown", centre + 5);
  await pointer(borne("endFrame"), "pointermove", centre + 1);
  await pointer(borne("endFrame"), "pointerup", centre + 1);
  expect(changer).toHaveBeenLastCalledWith(5_000, 5_000 + longueur - 80);
});

it("arrête la poignée à dix secondes sans déplacer la borne opposée", async () => {
  const changer = vi.fn();
  await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={20_000} onChange={changer} essai={null} onFinEssai={() => {}} />);
  geometrie(piste());
  await pointer(borne("endFrame"), "pointerdown", 505);
  await pointer(borne("endFrame"), "pointermove", 515);
  await pointer(borne("endFrame"), "pointerup", 515);
  expect(borne("startFrame").getAttribute("aria-valuenow")).toBe("0");
  expect(borne("endFrame").getAttribute("aria-valuenow")).toBe("10000");
  expect(changer).not.toHaveBeenCalled();
});

it("garde le repère du zoom pendant le glissement et permet le réglage à la milliseconde", async () => {
  const changer = vi.fn();
  await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={60_000} onChange={changer} essai={null} onFinEssai={() => {}} />);
  geometrie(piste("editorZoom"));
  const debut = borne("startFrame", true);
  await pointer(debut, "pointerdown", 12);
  await pointer(debut, "pointermove", 112);
  await pointer(debut, "pointermove", 212);
  await pointer(debut, "pointerup", 212);
  expect(changer).toHaveBeenLastCalledWith(2_800, 10_000);
  await act(async () => debut.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true })));
  expect(changer).toHaveBeenLastCalledWith(2_801, 10_000);
});

it("zoome autour du curseur et place celui-ci sans modifier la sélection", async () => {
  const changer = vi.fn();
  await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={60_000} onChange={changer} essai={null} onFinEssai={() => {}} />);
  geometrie(piste("editorZoom"));
  await act(async () => vue.container.querySelector<HTMLButtonElement>('[aria-label="memeboard.editorZoomIn"]')!.click());
  await pointer(piste("editorZoom"), "pointerdown", 500);
  await pointer(piste("editorZoom"), "pointerup", 500);
  expect(vue.container.textContent).toContain("● 0:07.000");
  expect(changer).not.toHaveBeenCalled();
});

it("lit depuis le curseur, met en pause et fixe sur la position native exacte", async () => {
  mocks.lecteur.mockClear();
  mocks.pause.mockResolvedValue(etat(7_350, true));
  mocks.etat.mockResolvedValue(etat(7_488, true));
  const changer = vi.fn();
  await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={20_000} onChange={changer} essai={null} onFinEssai={() => {}} />);
  geometrie(piste("editorZoom"));
  await pointer(piste("editorZoom"), "pointerdown", 500);
  await pointer(piste("editorZoom"), "pointerup", 500);
  await clicBouton("editorPlayCursor");
  const lecteur = mocks.lecteur.mock.calls.at(-1)![0] as LecteurProps;
  expect(lecteur.source).toBe("clip.mp4");
  expect(lecteur.departMs).toBe(7_000);
  await act(async () => lecteur.onEtatChange(etat(7_350)));
  await clicBouton("chat.pause");
  expect(mocks.pause).toHaveBeenLastCalledWith(true);
  await clicBouton("editorFixStart");
  expect(changer).toHaveBeenLastCalledWith(7_488, 10_000);
  expect(vue.container.querySelector("[data-lecteur]")).toBeNull();
});

it("garde le bouton de lecture de la sélection et désactive l'édition pendant la préparation", async () => {
  const tester = vi.fn();
  const props = { source: "clip.mp4", dureeMs: 20_000, onChange: vi.fn(), essai: null, onFinEssai: vi.fn(), onTesterSelection: tester };
  await vue.render(<MemeTrimmer {...props} />);
  await clicBouton("editorPlaySelection");
  expect(tester).toHaveBeenCalledOnce();
  await vue.render(<MemeTrimmer {...props} occupe />);
  expect(piste().getAttribute("aria-disabled")).toBe("true");
  expect(borne("startFrame").tabIndex).toBe(-1);
});

it("demande la dernière image de la sélection pour l'aperçu de fin", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("URL", { createObjectURL: () => "blob:image", revokeObjectURL: vi.fn() });
  try {
    mocks.image.mockClear();
    await vue.render(<MemeTrimmer source="clip.mp4" dureeMs={20_000} onChange={() => {}} essai={null} onFinEssai={() => {}} />);
    geometrie(piste());
    await pointer(borne("endFrame"), "pointerdown", 500);
    await pointer(borne("endFrame"), "pointerup", 500);
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(mocks.image).toHaveBeenLastCalledWith("clip.mp4", 0, 10_000);
  } finally { vi.useRealTimers(); }
});
