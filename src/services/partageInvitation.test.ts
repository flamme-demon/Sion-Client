import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { partagerInvitation } from "./partageInvitation";

vi.mock("./espacesService", () => ({ lienEspace: (id: string) => `https://matrix.to/#/${encodeURIComponent(id)}?via=example.test` }));
const copie = vi.fn().mockResolvedValue(undefined);
beforeEach(() => { copie.mockClear(); vi.stubGlobal("navigator", { clipboard: { writeText: copie } }); delete window.__SION_PARTAGE__; });
afterEach(() => { vi.unstubAllGlobals(); delete window.__SION_PARTAGE__; });

it("sur Android, ouvre le sélecteur natif immédiatement avec le bon lien", async () => {
  const partagerLien = vi.fn(() => true);
  const share = vi.fn();
  window.__SION_PARTAGE__ = { partagerLien };
  Object.assign(navigator, { share });
  const resultat = partagerInvitation("!espace:example.test", "Rejoindre mon équipe", true);
  expect(partagerLien).toHaveBeenCalledWith("Rejoindre mon équipe", "https://matrix.to/#/!espace%3Aexample.test?via=example.test");
  expect(await resultat).toBe("partage");
  expect(share).not.toHaveBeenCalled();
  expect(copie).not.toHaveBeenCalled();
});

it("utilise le partage du navigateur mobile quand le pont Android est absent", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { share });
  expect(await partagerInvitation("!espace", "Équipe", true)).toBe("partage");
  expect(share).toHaveBeenCalledWith({ title: "Équipe", url: "https://matrix.to/#/!espace?via=example.test" });
  expect(copie).not.toHaveBeenCalled();
});

it("annuler le partage ne copie rien et ne devient pas une erreur", async () => {
  Object.assign(navigator, { share: vi.fn().mockRejectedValue(new DOMException("Annulé", "AbortError")) });
  expect(await partagerInvitation("!espace", "Équipe", true)).toBe("annule");
  expect(copie).not.toHaveBeenCalled();
});

it("un échec réel du sélecteur remonte sans copier discrètement le lien", async () => {
  Object.assign(navigator, { share: vi.fn().mockRejectedValue(new Error("Indisponible")) });
  await expect(partagerInvitation("!espace", "Équipe", true)).rejects.toThrow("Indisponible");
  expect(copie).not.toHaveBeenCalled();
});

it.each([false, true])("copie le lien en l'absence de partage système (mobile=%s)", async (mobile) => {
  expect(await partagerInvitation("!espace", "Équipe", mobile)).toBe("copie");
  expect(copie).toHaveBeenCalledWith("https://matrix.to/#/!espace?via=example.test");
});

it("sur ordinateur, la copie reste immédiate même si Web Share existe", async () => {
  const share = vi.fn(); Object.assign(navigator, { share });
  expect(await partagerInvitation("!espace", "Équipe", false)).toBe("copie");
  expect(share).not.toHaveBeenCalled();
});

it("signale un presse-papiers indisponible", async () => {
  copie.mockRejectedValueOnce(new Error("Refusé"));
  await expect(partagerInvitation("!espace", "Équipe", false)).rejects.toThrow("Refusé");
});
