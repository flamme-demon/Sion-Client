import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import type { SoundEntry } from "../../services/soundboardService";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), edit: vi.fn(), trim: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string) => cle }) }));
vi.mock("../../services/soundboardService", () => ({
  uploadSound: mocks.upload, editSound: mocks.edit, playSoundLocal: vi.fn(),
  SOUND_GAIN_MIN: 0, SOUND_GAIN_MAX: 3, SOUND_GAIN_DEFAULT: 1,
}));
vi.mock("../../services/audioTrim", () => ({ trimToClip: mocks.trim }));
vi.mock("../../services/ttsService", () => ({ TTS_MODEL_LABELS: {} }));
vi.mock("../../utils/plateforme", () => ({ SUR_ANDROID: false }));
vi.mock("./AudioTrimmer", () => ({ AudioTrimmer: () => <div data-audio-trimmer style={{ height: 1000 }}>Éditeur audio</div> }));
vi.mock("./ExternalAudioImport", () => ({ ExternalAudioImport: ({ onImported }: { onImported: (f: File, nom: string) => void }) =>
  <button type="button" onClick={() => onImported(new File(["audio"], "Extrait.ogg", { type: "audio/ogg" }), "Titre récupéré")}>Récupérer le son</button>,
}));
vi.mock("./EmojiGridPanel", () => ({ EmojiGridPanel: ({ onPick }: { onPick: (emoji: string) => void }) =>
  <button type="button" data-emoji onClick={() => onPick("🎵")}>Choisir</button>,
}));
import { SoundboardUploadModal } from "./SoundboardUploadModal";

const vue = montage();
const fermer = vi.fn();
const envoye = vi.fn();
const molettePanneau = vi.fn();
const touchePanneau = vi.fn();
const dialogue = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
const bouton = (texte: string) => [...dialogue().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texte)!;
const cliquer = async (texte: string) => { await act(async () => bouton(texte).click()); };
const afficher = (editing: SoundEntry | null = null) => vue.render(<div onWheel={molettePanneau} onKeyDown={touchePanneau}>
  <SoundboardUploadModal existingCategories={[]} maxSize={1_000_000} onClose={fermer} onUploaded={envoye} editing={editing} />
</div>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue(undefined);
  mocks.edit.mockResolvedValue(undefined);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:son"), revokeObjectURL: vi.fn() });
  vue.container.style.cssText = "contain: strict; overflow: hidden; width: 300px; height: 300px";
});

it.each([false, true])("sort la fenêtre du module et garde les actions hors du contenu défilant (édition : %s)", async (edition) => {
  const existing = { eventId: "$son", label: "Extrait", category: "Autre", emoji: null, gain: 1, mxcUrl: "mxc://son" } as SoundEntry;
  await afficher(edition ? existing : null);
  const carte = dialogue();
  expect(carte.parentElement!.parentElement).toBe(document.body);
  expect(vue.container.contains(carte)).toBe(false);
  expect(carte.style.maxHeight).toBe("calc(100dvh - 32px)");
  const corps = carte.querySelector<HTMLElement>(".sion-board-import-corps")!;
  expect(corps.style.overflowY).toBe("auto");
  expect(corps.style.minHeight).toBe("0px");
  const actions = carte.querySelector<HTMLElement>(".sion-board-import-actions")!;
  expect(actions.parentElement).toBe(carte);
  expect(actions.style.flexShrink).toBe("0");
  expect(corps.contains(actions)).toBe(false);
  expect(actions.contains(bouton(edition ? "soundboard.editBtn" : "soundboard.uploadBtn"))).toBe(true);
});

it("garde Envoyer accessible après le téléchargement et conserve le fichier lors du défilement", async () => {
  await afficher();
  await cliquer("soundboard.modeUrl");
  await cliquer("Récupérer le son");
  const corps = dialogue().querySelector<HTMLElement>(".sion-board-import-corps")!;
  expect(corps.querySelector("[data-audio-trimmer]")).not.toBeNull();
  expect(corps.contains(bouton("soundboard.uploadBtn"))).toBe(false);
  const molette = new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true });
  await act(async () => {
    corps.scrollTop = 1000;
    corps.dispatchEvent(molette);
    corps.dispatchEvent(new Event("scroll"));
    corps.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(molette.defaultPrevented).toBe(false);
  expect(molettePanneau).not.toHaveBeenCalled();
  expect(touchePanneau).not.toHaveBeenCalled();
  expect(fermer).not.toHaveBeenCalled();
  expect(bouton("soundboard.uploadBtn").disabled).toBe(false);
  await cliquer("soundboard.uploadBtn");
  expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ name: "Extrait.ogg" }), "Titre récupéré", "Autre", null, 1);
  expect(envoye).toHaveBeenCalledOnce();
});

it("conserve le sélecteur d'emoji et la fermeture explicite par Annuler", async () => {
  await afficher();
  await cliquer("soundboard.modeUrl");
  await cliquer("Récupérer le son");
  await act(async () => dialogue().parentElement!.click());
  expect(fermer).not.toHaveBeenCalled();
  await cliquer("🔊");
  const selecteur = document.querySelector<HTMLElement>("[data-emoji]")!.parentElement!;
  expect(selecteur.style.position).toBe("fixed");
  expect(vue.container.contains(selecteur)).toBe(false);
  await act(async () => selecteur.querySelector<HTMLButtonElement>("button")!.click());
  expect(bouton("🎵")).toBeDefined();
  const annuler = dialogue().querySelector(".sion-board-import-actions button") as HTMLButtonElement;
  await act(async () => annuler.click());
  expect(fermer).toHaveBeenCalledOnce();
  expect(mocks.upload).not.toHaveBeenCalled();
});
