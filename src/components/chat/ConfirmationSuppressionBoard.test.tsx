import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { ConfirmationSuppressionBoard } from "./ConfirmationSuppressionBoard";

vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
}) }));
const vue = montage();
const confirmer = vi.fn();
const fermer = vi.fn();
const panneau = vi.fn();
const dialogue = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!;
const bouton = (action: string) => dialogue().querySelector<HTMLButtonElement>(`[data-action="${action}-suppression"]`)!;
const afficher = () => vue.render(<div onKeyDown={panneau}>
  <ConfirmationSuppressionBoard titre="Supprimer ce son ?" description="« Extrait de test » sera retiré pour tous les membres."
    messageErreur="Suppression impossible." onConfirmer={confirmer} onFermer={fermer} />
</div>);
beforeEach(() => {
  confirmer.mockReset().mockResolvedValue(undefined);
  fermer.mockReset();
  panneau.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it("reste au-dessus du panneau, garde le focus au clavier et ferme uniquement la confirmation avec Échap", async () => {
  const origine = document.createElement("button");
  document.body.append(origine);
  origine.focus();
  await afficher();
  expect(vue.container.contains(dialogue())).toBe(false);
  expect(document.activeElement).toBe(bouton("annuler"));
  await act(async () => bouton("annuler").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
  expect(document.activeElement).toBe(bouton("confirmer"));
  await act(async () => bouton("confirmer").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
  expect(document.activeElement).toBe(bouton("annuler"));
  await act(async () => bouton("annuler").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(fermer).toHaveBeenCalledOnce();
  expect(confirmer).not.toHaveBeenCalled();
  expect(panneau).not.toHaveBeenCalled();
  await vue.render(null);
  expect(document.activeElement).toBe(origine);
  origine.remove();
});

it("Annuler ne lance aucune suppression", async () => {
  await afficher();
  await act(async () => bouton("annuler").click());
  expect(fermer).toHaveBeenCalledOnce();
  expect(confirmer).not.toHaveBeenCalled();
});

it("un double clic n'envoie qu'une requête et la fenêtre reste ouverte pendant la suppression", async () => {
  let terminer!: () => void;
  confirmer.mockImplementation(() => new Promise<void>((resolve) => { terminer = resolve; }));
  await afficher();
  await act(async () => { bouton("confirmer").click(); bouton("confirmer").click(); });
  expect(confirmer).toHaveBeenCalledOnce();
  expect(dialogue().getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(dialogue());
  expect(bouton("annuler").disabled).toBe(true);
  expect(bouton("confirmer").disabled).toBe(true);
  expect(bouton("confirmer").textContent).toBe("Suppression…");
  await act(async () => {
    dialogue().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.querySelector<HTMLElement>(".sion-confirmation-suppression-fond")!.click();
  });
  expect(fermer).not.toHaveBeenCalled();
  await act(async () => terminer());
  expect(fermer).toHaveBeenCalledOnce();
});

it("une erreur reste visible et permet de réessayer", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  confirmer.mockRejectedValueOnce(new Error("Échec simulé"));
  await afficher();
  await act(async () => bouton("confirmer").click());
  expect(dialogue().querySelector('[role="alert"]')?.textContent).toBe("Suppression impossible.");
  expect(fermer).not.toHaveBeenCalled();
  expect(bouton("confirmer").disabled).toBe(false);
  await act(async () => bouton("confirmer").click());
  expect(confirmer).toHaveBeenCalledTimes(2);
  expect(fermer).toHaveBeenCalledOnce();
});
