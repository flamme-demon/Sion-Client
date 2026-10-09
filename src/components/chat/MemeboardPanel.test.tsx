import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { MemeboardPanel } from "./MemeboardPanel";

const services = vi.hoisted(() => ({ declencherMeme: vi.fn(), modifierMeme: vi.fn(), envoyerMeme: vi.fn(), supprimerMeme: vi.fn(), rust: false }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options?: { defaultValue?: string; label?: string }) => options?.defaultValue ?? (options?.label ? `${key} ${options.label}` : key),
}) }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => services.rust }));
vi.mock("../../services/matrixService", () => ({
  findSoundboardRoom: async () => "!memes", getMatrixClient: () => null,
  canSendMessage: () => true, getMemberPowerLevel: () => 0, mxcToHttp: () => null,
}));
vi.mock("../../services/memeboardService", () => {
  const base = { mxcUrl: "mxc://hs/meme", apercuMxc: null, emoji: null, gain: 1,
    durationMs: 1000, largeur: 160, hauteur: 160, senderId: "@alice:hs", timestamp: 1 };
  return {
    declencherMeme: services.declencherMeme, delaiRestantMs: () => 5000,
    listMemes: async () => [
      { ...base, eventId: "$bravo", label: "Bravo", category: "Films/Comédie" },
      { ...base, eventId: "$jamais", label: "Jamais", category: "Films/Drame" },
      { ...base, eventId: "$zulu", label: "Zulu", category: "Réactions" },
      { ...base, eventId: "$alpha", label: "Alpha", category: "Films/Comédie" },
    ],
    modifierMeme: services.modifierMeme, envoyerMeme: services.envoyerMeme,
    supprimerMeme: services.supprimerMeme,
    deposerSource: async () => "/tmp/meme.mp4", analyserMeme: async () => ({ duree_ms: 1000 }),
    preparerMeme: async () => ({ video: "/tmp/prepare.mp4", mime: "video/mp4", taille: 10,
      largeur: 160, hauteur: 160, duree_ms: 1000, apercu: null, apercu_mime: null }),
    MEME_DUREE_MAX_MS: 10_000,
  };
});
vi.mock("./MemeTrimmer", () => ({ MemeTrimmer: () => null }));
vi.mock("./EmojiGridPanel", () => ({ EmojiGridPanel: () => null }));
const vue = montage();
const noms = () => Array.from(vue.container.querySelectorAll(".meme-tuile .sion-carte-board-nom")).map((c) => c.textContent);
beforeEach(() => {
  useMatrixStore.setState({ currentUserId: "@alice:hs" });
  useSettingsStore.setState({ memeboardView: "all", memeboardCategory: null, memeboardPlayCounts: {}, memeboardEnabled: true, memeboardVolume: 0.5 });
  services.declencherMeme.mockReset().mockResolvedValue(true);
  services.modifierMeme.mockReset().mockResolvedValue(undefined);
  services.envoyerMeme.mockReset().mockResolvedValue("$nouveau");
  services.supprimerMeme.mockReset().mockResolvedValue(undefined);
  services.rust = false;
});
afterEach(() => vi.restoreAllMocks());

it("TOP classe les mèmes joués par fréquence, puis par nom, sans modifier l'ordre de Tous", async () => {
  useSettingsStore.setState({ memeboardPlayCounts: { $bravo: 4, $alpha: 4, $zulu: 9, $supprime: 99 } });
  await vue.render(<MemeboardPanel />);
  expect(noms()).toEqual(["Bravo", "Jamais", "Zulu", "Alpha"]);
  await vue.click('[data-filter="top"]');
  expect(noms()).toEqual(["Zulu", "Alpha", "Bravo"]);
  expect(vue.container.querySelector('[data-filter="top"]')?.getAttribute("aria-pressed")).toBe("true");
  await vue.click('[data-filter="all"]');
  expect(noms()).toEqual(["Bravo", "Jamais", "Zulu", "Alpha"]);
});

it("la recherche reste disponible dans TOP et Tous", async () => {
  useSettingsStore.setState({ memeboardPlayCounts: { $bravo: 4, $alpha: 4, $zulu: 9 } });
  await vue.render(<MemeboardPanel />);
  await vue.click('[data-filter="top"]');
  const champ = vue.container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(champ, "al");
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(noms()).toEqual(["Alpha"]);
  await vue.click('[data-filter="all"]');
  expect(noms()).toEqual(["Alpha"]);
});

it("un lancement réussi alimente le TOP et son stockage persistant", async () => {
  await vue.render(<MemeboardPanel />);
  await vue.click('[title="Jamais"]');
  expect(services.declencherMeme).toHaveBeenCalledOnce();
  expect(useSettingsStore.getState().memeboardPlayCounts).toEqual({ $jamais: 1 });
  expect(JSON.parse(localStorage.getItem("sion-settings")!).state.memeboardPlayCounts).toEqual({ $jamais: 1 });
  await vue.click('[data-filter="top"]');
  expect(noms()).toEqual(["Jamais"]);
});

it("un clic refusé par l'anti-rafale ou une erreur n'augmente pas le classement", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  services.declencherMeme.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("Lecture impossible"));
  await vue.render(<MemeboardPanel />);
  await vue.click('[title="Jamais"]');
  expect(vue.container.textContent).toContain("memeboard.tooSoon");
  await vue.click('[title="Jamais"]');
  expect(vue.container.textContent).toContain("memeboard.playError");
  expect(useSettingsStore.getState().memeboardPlayCounts).toEqual({});
});

it("une memeboard désactivée ne déclenche ni lecture ni compteur", async () => {
  useSettingsStore.setState({ memeboardEnabled: false });
  await vue.render(<MemeboardPanel />);
  await vue.click(".meme-tuile");
  expect(services.declencherMeme).not.toHaveBeenCalled();
  expect(useSettingsStore.getState().memeboardPlayCounts).toEqual({});
});

it("le filtre et les fréquences reviennent après fermeture et réhydratation des réglages", async () => {
  useSettingsStore.setState({ memeboardPlayCounts: { $alpha: 2 } });
  await vue.render(<MemeboardPanel />);
  await vue.click('[data-filter="top"]');
  const sauvegarde = localStorage.getItem("sion-settings")!;
  await vue.render(null);
  useSettingsStore.setState({ memeboardView: "all", memeboardPlayCounts: {} });
  localStorage.setItem("sion-settings", sauvegarde);
  await useSettingsStore.persist.rehydrate();
  await vue.render(<MemeboardPanel />);
  expect(noms()).toEqual(["Alpha"]);
  expect(vue.container.querySelector('[data-filter="top"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("un TOP neuf explique comment le remplir et Tous reste accessible", async () => {
  useSettingsStore.setState({ memeboardView: "top" });
  await vue.render(<MemeboardPanel />);
  expect(noms()).toEqual([]);
  expect(vue.container.textContent).toContain("Ton TOP se remplira");
  await vue.click('[data-filter="all"]');
  expect(noms()).toHaveLength(4);
});

it("les réglages antérieurs conservent le TOP de la soundboard et initialisent les nouvelles préférences", async () => {
  localStorage.setItem("sion-settings", JSON.stringify({ version: 1, state: {
    soundboardView: { mode: "top", category: null }, soundboardPlayCounts: { $son: 7 }, soundboardFavorites: ["$favori"],
  } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState()).toMatchObject({
    soundboardView: { mode: "top", category: null }, soundboardPlayCounts: { $son: 7 },
    memeboardView: "all", memeboardCategory: null, memeboardPlayCounts: {},
  });
  expect(useSettingsStore.getState()).not.toHaveProperty("soundboardFavorites");
  await vue.render(<MemeboardPanel />);
  expect(noms()).toHaveLength(4);
});

it("les catégories imbriquées filtrent par chemin complet et gardent les catégories voisines accessibles", async () => {
  await vue.render(<MemeboardPanel />);
  await vue.click('[data-filter="Films"]');
  expect(noms()).toEqual(["Bravo", "Jamais", "Alpha"]);
  await vue.click('[data-filter="Films/Comédie"]');
  expect(noms()).toEqual(["Bravo", "Alpha"]);
  expect(vue.container.querySelector('[data-filter="Films/Drame"]')).not.toBeNull();
  expect(JSON.parse(localStorage.getItem("sion-settings")!).state.memeboardCategory).toBe("Films/Comédie");
  await vue.click('[data-filter="Films/Drame"]');
  expect(noms()).toEqual(["Jamais"]);
  await vue.click('[data-filter="all"]');
  expect(noms()).toHaveLength(4);
  await vue.click('[data-filter="Réactions"]');
  expect(noms()).toEqual(["Zulu"]);
  await vue.click('[data-filter="top"]');
  expect(useSettingsStore.getState().memeboardCategory).toBeNull();
});
it("le filtre compact conserve TOP, Tous et les chemins complets de catégorie", async () => {
  useSettingsStore.setState({ memeboardPlayCounts: { $zulu: 9 } });
  await vue.render(<MemeboardPanel />);
  const select = vue.container.querySelector<HTMLSelectElement>(".sion-board-filtre-compact")!;
  expect(select.querySelector('[value="category:Films"]')).not.toBeNull();
  await act(async () => { select.value = "category:Films/Drame"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(noms()).toEqual(["Jamais"]);
  expect(useSettingsStore.getState().memeboardCategory).toBe("Films/Drame");
  await act(async () => { select.value = "top"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(noms()).toEqual(["Zulu"]);
  expect(useSettingsStore.getState().memeboardCategory).toBeNull();
  await act(async () => { select.value = "all"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(noms()).toHaveLength(4);
});

it("une catégorie seule se modifie sans changer le nom, l'emoji ou l'identifiant du mème", async () => {
  await vue.render(<MemeboardPanel />);
  services.rust = true;
  await act(async () => useSettingsStore.setState({ memeboardVolume: 0.6 }));
  await vue.click('[title="Bravo"] [data-action="modifier"]');
  expect(services.declencherMeme).not.toHaveBeenCalled();
  const categorie = vue.container.querySelector<HTMLInputElement>('input[list]')!;
  expect(categorie.value).toBe("Films/Comédie");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(categorie, " Réactions / Rires ");
    categorie.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => Array.from(vue.container.querySelectorAll("button")).find((b) => b.textContent === "memeboard.save")!.click());
  expect(services.modifierMeme).toHaveBeenCalledWith("$bravo", "Bravo", null, "Réactions/Rires");
});
it("la suppression d'un mème demande la même confirmation intégrée et n'envoie rien après Annuler", async () => {
  const native = vi.spyOn(window, "confirm").mockReturnValue(true);
  await vue.render(<MemeboardPanel />);
  await vue.click('[title="Bravo"] [data-action="supprimer"]');
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Bravo");
  expect(services.supprimerMeme).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('[data-action="annuler-suppression"]')!.click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(services.supprimerMeme).not.toHaveBeenCalled();
  await vue.click('[title="Bravo"] [data-action="supprimer"]');
  await act(async () => document.querySelector<HTMLButtonElement>('[data-action="confirmer-suppression"]')!.click());
  expect(services.supprimerMeme).toHaveBeenCalledExactlyOnceWith("$bravo");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(services.declencherMeme).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});

it("l'import propose la catégorie consultée et envoie le chemin choisi", async () => {
  await vue.render(<MemeboardPanel />);
  await vue.click('[data-filter="Films"]');
  await vue.click('[aria-label="memeboard.add"]');
  const fichier = vue.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(fichier, "files", { value: [new File(["meme"], "Extrait.mp4", { type: "video/mp4" })] });
    fichier.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const categorie = vue.container.querySelector<HTMLInputElement>('input[list]')!;
  expect(categorie.value).toBe("Films");
  expect(vue.container.querySelector('datalist option[value="Films/Comédie"]')).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(categorie, "Films / Kaamelott");
    categorie.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => Array.from(vue.container.querySelectorAll("button")).find((b) => b.textContent === "memeboard.send")!.click());
  expect(services.envoyerMeme).toHaveBeenCalledWith(expect.objectContaining({ video: "/tmp/prepare.mp4" }), "Extrait", null, "Films/Kaamelott");
});
