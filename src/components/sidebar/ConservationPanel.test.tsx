import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { ConservationPanel } from "./ConservationPanel";
import type { VueConservation } from "../../services/conservationService";
import { ErreurApiAdmin } from "../../services/matrixCore";

const appels = vi.hoisted(() => ({ lire: vi.fn(), apercu: vi.fn(), enregistrer: vi.fn() }));
vi.mock("../../i18n", () => ({ default: { t: (c: string) => c } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (c: string, p?: Record<string, unknown>) => p?.count !== undefined ? `${c} ${p.count}` : c,
  i18n: { language: "fr", exists: () => true } }) }));
vi.mock("../../services/conservationService", async (original) => ({ ...await original<typeof import("../../services/conservationService")>(),
  lireConservation: appels.lire, apercuConservation: appels.apercu, enregistrerConservation: appels.enregistrer }));
const vue = montage();
let donnees: VueConservation;
const bouton = (cle: string) => Array.from(vue.container.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === cle)!;
const changer = async (select: HTMLSelectElement, valeur: string) => {
  await act(async () => { select.value = valeur; select.dispatchEvent(new Event("change", { bubbles: true })); });
};
beforeEach(() => {
  donnees = { available: true, applying: false, lastRun: null, scope: { id: "!space:hs", name: "Equipe", isSpace: true,
    policy: { mode: "unlimited" }, effectiveDays: null, parentId: null, parentName: null, editable: true, protected: false }, rooms: [
      { id: "!chat:hs", name: "Général", isSpace: false, policy: { mode: "inherit", parent: "!space:hs" }, effectiveDays: null, parentId: "!space:hs", parentName: "Equipe", editable: true, protected: false },
      { id: "!board:hs", name: "Soundboard & Memeboard", isSpace: false, policy: { mode: "unlimited" }, effectiveDays: null, parentId: null, parentName: null, editable: false, protected: true },
  ] };
  appels.lire.mockReset().mockImplementation(async () => structuredClone(donnees));
  appels.apercu.mockReset().mockResolvedValue({ revision: "aperçu", expiresAt: Date.now() + 300000, messages: 240, files: 35, protectedFiles: 8, uncertainFiles: 3, blockedMessages: 2 });
  appels.enregistrer.mockReset().mockImplementation(async () => structuredClone(donnees));
});
it("affiche le mode aperçu et exclut la bibliothèque des sélecteurs", async () => {
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  expect(vue.container.textContent).toContain("conservation.previewMode");
  expect(vue.container.querySelectorAll("select")).toHaveLength(2);
  expect(vue.container.textContent).toContain("conservation.permanent");
  expect(bouton("spaces.save").disabled).toBe(true);
});
it("exige un aperçu puis invalide cet aperçu à chaque modification", async () => {
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  await changer(vue.container.querySelector("select")!, "90");
  expect(vue.container.textContent).toContain("conservation.effectiveDays 90");
  expect(bouton("spaces.save").disabled).toBe(true);
  await act(async () => bouton("conservation.preview").click());
  expect(appels.apercu).toHaveBeenCalledExactlyOnceWith("!space:hs", [{ roomId: "!space:hs", policy: { mode: "days", days: 90 } }]);
  expect(bouton("spaces.save").disabled).toBe(false);
  expect(vue.container.textContent).toContain("conservation.uncertainCount 3");
  await changer(vue.container.querySelectorAll("select")[1], "unlimited");
  expect(bouton("spaces.save").disabled).toBe(true);
  expect(appels.enregistrer).not.toHaveBeenCalled();
});
it("enregistre les règles avec la révision sans lancer de suppression depuis le client", async () => {
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  await changer(vue.container.querySelector("select")!, "30");
  await act(async () => bouton("conservation.preview").click());
  await act(async () => bouton("spaces.save").click());
  expect(appels.enregistrer).toHaveBeenCalledExactlyOnceWith("!space:hs", [{ roomId: "!space:hs", policy: { mode: "days", days: 30 } }], "aperçu");
  expect(vue.container.textContent).toContain("conservation.saved");
  expect(bouton("spaces.save").disabled).toBe(true);
});
it("un serveur absent reste consultable sans commandes actives", async () => {
  donnees.available = false;
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  expect(vue.container.textContent).toContain("conservation.unavailable");
  expect(Array.from(vue.container.querySelectorAll("select")).every((s) => s.disabled)).toBe(true);
  expect(bouton("spaces.save")).toBeUndefined();
  expect(appels.apercu).not.toHaveBeenCalled();
});
it("un membre voit les durées sans pouvoir les modifier", async () => {
  donnees.scope.editable = false; donnees.rooms.forEach((r) => { r.editable = false; });
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  expect(Array.from(vue.container.querySelectorAll("select")).every((s) => s.disabled)).toBe(true);
  expect(vue.container.textContent).toContain("conservation.adminOnly");
});
it("un aperçu périmé n'est jamais envoyé à l'enregistrement", async () => {
  appels.apercu.mockResolvedValue({ revision: "périmé", expiresAt: Date.now() - 1, messages: 0, files: 0, protectedFiles: 0, uncertainFiles: 0, blockedMessages: 0 });
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  await changer(vue.container.querySelector("select")!, "90");
  await act(async () => bouton("conservation.preview").click());
  await act(async () => bouton("spaces.save").click());
  expect(appels.enregistrer).not.toHaveBeenCalled();
  expect(vue.container.querySelector('[role="alert"]')?.textContent).toContain("conservation.previewExpired");
});
it("un conflit serveur demande un nouvel aperçu et conserve le brouillon", async () => {
  appels.enregistrer.mockRejectedValue(new ErreurApiAdmin(409, "M_INVALID_PARAM"));
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  await changer(vue.container.querySelector("select")!, "90");
  await act(async () => bouton("conservation.preview").click());
  await act(async () => bouton("spaces.save").click());
  expect(vue.container.querySelector('[role="alert"]')?.textContent).toContain("conservation.previewExpired");
  expect(vue.container.querySelector<HTMLSelectElement>("select")!.value).toBe("90");
  expect(bouton("spaces.save").disabled).toBe(true);
});
it("ignore un chargement arrivé après avoir changé de salon", async () => {
  let finir!: (v: VueConservation) => void;
  appels.lire.mockImplementationOnce(() => new Promise((resolve) => { finir = resolve; }));
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  const autre = structuredClone(donnees); autre.scope.id = "!autre:hs"; autre.scope.name = "Autre équipe";
  appels.lire.mockResolvedValue(autre);
  await vue.render(<ConservationPanel scopeId="!autre:hs" />);
  await act(async () => finir(donnees));
  expect(vue.container.textContent).toContain("Autre équipe");
  expect(vue.container.querySelector('label')?.textContent).not.toBe("Equipe");
});
it("une actualisation reste prioritaire sur le chargement initial tardif", async () => {
  let finir!: (v: VueConservation) => void;
  appels.lire.mockImplementationOnce(() => new Promise((resolve) => { finir = resolve; }));
  await vue.render(<ConservationPanel scopeId="!space:hs" />);
  const actuelle = structuredClone(donnees); actuelle.scope.name = "Equipe actualisée";
  appels.lire.mockResolvedValue(actuelle);
  await act(async () => bouton("spaces.refresh").click());
  await act(async () => finir(donnees));
  expect(vue.container.querySelector('label')?.textContent).toBe("Equipe actualisée");
});
