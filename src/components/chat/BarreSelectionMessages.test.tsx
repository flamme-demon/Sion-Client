import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { BarreSelectionMessages } from "./BarreSelectionMessages";
import { useMatrixStore } from "../../stores/useMatrixStore";

const serveur = vi.hoisted(() => ({ autorise: true, supprimer: vi.fn(), retirer: vi.fn(), annuler: vi.fn() }));
vi.mock("../../services/supprimerMessages", () => ({ peutSupprimerMessage: () => serveur.autorise, supprimerMessages: serveur.supprimer }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const vue = montage();
beforeEach(() => {
  vi.clearAllMocks(); serveur.autorise = true;
  serveur.supprimer.mockResolvedValue({ supprimes: ["$1"], echecs: ["$2"], interrompu: false });
  useMatrixStore.setState({ currentUserId: "@moi:hs", messages: { "!salon": [{ id: "$1", senderId: "@moi:hs", user: "Moi", text: "Texte", role: "user", time: "" }, { id: "$2", senderId: "@moi:hs", user: "Moi", text: "Texte", role: "user", time: "" }] } });
});
const rendre = () => vue.render(<BarreSelectionMessages salon="!salon" ids={new Set(["$1", "$2"])} onRetirer={serveur.retirer} onAnnuler={serveur.annuler} />);
it("demande confirmation, n'envoie pas en cas d'annulation et conserve les échecs sélectionnés", async () => {
  await rendre();
  await vue.click('[aria-label="chat.deleteSelected"]');
  expect(vue.container.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(serveur.supprimer).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(serveur.annuler).not.toHaveBeenCalled();
  await vue.click('[aria-label="chat.deleteSelected"]'); await vue.click('[data-confirmer-suppression]');
  expect(serveur.supprimer).toHaveBeenCalledExactlyOnceWith("!salon", ["$1", "$2"]);
  expect(serveur.retirer).toHaveBeenCalledExactlyOnceWith(["$1"]);
  expect(vue.container.querySelector('[role="alert"]')?.textContent).toBe("chat.deleteSelectedFailed");
});
it("bloque une sélection non autorisée", async () => {
  serveur.autorise = false; await rendre();
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.deleteSelected"]')?.disabled).toBe(true);
  expect(vue.container.textContent).toContain("chat.selectionNotAllowed");
});
it("un double clic de confirmation ne lance qu'un lot", async () => {
  let terminer!: (resultat: unknown) => void;
  serveur.supprimer.mockReturnValue(new Promise((resolve) => { terminer = resolve; }));
  await rendre(); await vue.click('[aria-label="chat.deleteSelected"]');
  await act(async () => { const bouton = vue.container.querySelector<HTMLButtonElement>('[data-confirmer-suppression]')!; bouton.click(); bouton.click(); });
  expect(serveur.supprimer).toHaveBeenCalledTimes(1);
  await act(async () => { terminer({ supprimes: ["$1", "$2"], echecs: [], interrompu: false }); });
});
