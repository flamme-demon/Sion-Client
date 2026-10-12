import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { useMatrixStore } from "../../stores/useMatrixStore";
import type { ResultatAnnuaire } from "../../services/matrixCore";
import { InvitationEspace } from "./InvitationEspace";

const appels = vi.hoisted(() => ({ rechercher: vi.fn(), inviter: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string) => cle }) }));
vi.mock("../../services/matrixService", () => ({ rechercherUtilisateurs: appels.rechercher }));
const vue = montage();
const resultat = (ids: string[]): ResultatAnnuaire => ({ utilisateurs: ids.map((id) => ({ userId: id, displayName: "Alice", avatarUrl: null })), limite: false });
beforeEach(() => {
  vi.useFakeTimers();
  useMatrixStore.setState({ currentUserId: "@moi:hs" });
  appels.rechercher.mockReset().mockResolvedValue(resultat(["@moi:hs", "@present:hs", "@alice:hs", "@alice:ailleurs"]));
  appels.inviter.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());
const afficher = (visible = true) => vue.render(<InvitationEspace membres={[{ userId: "@present:hs" }]} visible={visible} disabled={false} onInvite={appels.inviter} />);
async function saisir(texte: string) {
  await act(async () => {
    const input = vue.container.querySelector<HTMLInputElement>('[role="combobox"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, texte);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const attendre = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
const soumettre = () => act(async () => { vue.container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
it("recherche après la frappe, écarte soi-même et les membres déjà présents, et invite uniquement le profil choisi", async () => {
  await afficher();
  await saisir("a"); await attendre();
  expect(appels.rechercher).not.toHaveBeenCalled();
  await saisir("al"); await saisir("alice");
  expect(appels.rechercher).not.toHaveBeenCalled();
  await attendre();
  expect(appels.rechercher).toHaveBeenCalledExactlyOnceWith("alice");
  const profils = vue.container.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(profils).toHaveLength(2);
  expect(profils[0].textContent).toContain("@alice:hs");
  expect(profils[1].textContent).toContain("@alice:ailleurs");
  await soumettre(); expect(appels.inviter).not.toHaveBeenCalled();
  await act(async () => profils[1].click()); await soumettre();
  expect(appels.inviter).toHaveBeenCalledExactlyOnceWith("@alice:ailleurs");
  expect(vue.container.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe("");
  await saisir("alice"); await attendre();
  expect(vue.container.querySelectorAll('[role="option"]')).toHaveLength(1);
});
it("ignore une ancienne recherche terminée après la nouvelle", async () => {
  let ancienne!: (r: ResultatAnnuaire) => void;
  appels.rechercher.mockImplementationOnce(() => new Promise<ResultatAnnuaire>((resolve) => { ancienne = resolve; }))
    .mockResolvedValueOnce(resultat(["@bob:hs"]));
  await afficher(); await saisir("alice"); await attendre();
  await saisir("bob"); await attendre();
  await act(async () => ancienne(resultat(["@alice:hs"])));
  expect(vue.container.querySelector('[role="option"]')?.textContent).toContain("@bob:hs");
  expect(vue.container.querySelector('[role="option"]')?.textContent).not.toContain("@alice:hs");
});
it("conserve le profil après une invitation refusée et permet de changer de membre", async () => {
  appels.inviter.mockResolvedValue(false);
  await afficher(); await saisir("alice"); await attendre();
  await act(async () => vue.container.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  await soumettre();
  expect(vue.container.querySelector('.sion-espaces-invite-selection')?.textContent).toContain("@alice:hs");
  await vue.click('[aria-label="spaces.changeMember"]');
  expect(vue.container.querySelector('.sion-espaces-invite-selection')).toBeNull();
  expect(document.activeElement?.getAttribute("role")).toBe("combobox");
});
it("permet de sélectionner au clavier un identifiant complet absent de l'annuaire", async () => {
  appels.rechercher.mockResolvedValue(resultat([]));
  await afficher(); await saisir("@ami:autre-serveur.test"); await attendre();
  const input = vue.container.querySelector('[role="combobox"]')!;
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  expect(input.getAttribute("aria-activedescendant")).toBe(vue.container.querySelector('[role="option"]')?.id);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  await soumettre();
  expect(appels.inviter).toHaveBeenCalledExactlyOnceWith("@ami:autre-serveur.test");
});
it("annule le délai et conserve le brouillon quand on change de rubrique", async () => {
  await afficher(); await saisir("alice");
  await afficher(false); await attendre();
  expect(appels.rechercher).not.toHaveBeenCalled();
  expect(vue.container.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe("alice");
  await afficher(); await attendre();
  expect(appels.rechercher).toHaveBeenCalledExactlyOnceWith("alice");
});
it("signale une indisponibilité de l'annuaire et permet de réessayer", async () => {
  appels.rechercher.mockRejectedValueOnce(new Error("indisponible"));
  await afficher(); await saisir("alice"); await attendre();
  expect(vue.container.querySelector('[role="alert"]')?.textContent).toBe("spaces.memberSearchUnavailable");
  await act(async () => Array.from(vue.container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === "spaces.retrySearch")!.click());
  await attendre();
  expect(vue.container.querySelectorAll('[role="option"]')).toHaveLength(2);
  expect(vue.container.querySelector('[role="alert"]')).toBeNull();
});
