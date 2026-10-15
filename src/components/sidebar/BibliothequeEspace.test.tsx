import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { BibliothequeEspace } from "./BibliothequeEspace";
import type { AccesBibliotheque } from "../../services/bibliothequeEspaceService";
import { useMatrixStore } from "../../stores/useMatrixStore";

const appels = vi.hoisted(() => ({ charger: vi.fn(), creer: vi.fn(), inviter: vi.fn(), moderer: vi.fn(), busy: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { count?: number; user?: string }) =>
  `${key}${options?.count === undefined ? "" : ` ${options.count}`}${options?.user ? ` ${options.user}` : ""}` }) }));
vi.mock("../../services/espacesService", () => ({ creerBibliotheque: appels.creer }));
vi.mock("../../services/bibliothequeEspaceService", () => ({ chargerBibliothequeEspace: appels.charger, inviterBibliothequeEspace: appels.inviter, modererBibliothequeEspace: appels.moderer }));
const vue = montage();
let acces: AccesBibliotheque;
const membre = (userId: string) => ({ userId, displayName: userId.slice(1), powerLevel: 0 });
const bouton = (texte: string) => Array.from(vue.container.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === texte)!;
const afficher = (id = "!equipe") => vue.render(<BibliothequeEspace key={id} espaceId={id} onBusyChange={appels.busy} />);
const changerChamp = async (selecteur: string, valeur: string) => act(async () => {
  const input = vue.container.querySelector<HTMLInputElement>(selecteur)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valeur);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
beforeEach(() => {
  vi.resetAllMocks(); useMatrixStore.setState({ channels: [] });
  acces = { salon: "!board", administrateur: true, peutInviter: true,
    membres: [{ ...membre("@alice:hs"), peutExpulser: true, peutBannir: true }, membre("@admin:hs")],
    invitations: [membre("@attente:hs")], manquants: [membre("@absent:hs"), membre("@autre:hs")],
    exclus: [{ ...membre("@banni:hs"), banni: true, peutRetablir: true }] };
  appels.charger.mockImplementation(async () => structuredClone(acces));
  appels.creer.mockResolvedValue({ roomId: "!nouveau", echecs: [] });
  appels.inviter.mockImplementation(async (_espace: string, _salon: string, id?: string) => {
    const cibles = acces.manquants.filter((m) => !id || m.userId === id);
    acces.invitations.push(...cibles); acces.manquants = acces.manquants.filter((m) => !cibles.includes(m));
    return { echecs: [], invitedCount: cibles.length };
  });
  appels.moderer.mockResolvedValue(undefined);
});
it("affiche les compteurs et ouvre la liste correspondante au clic", async () => {
  await afficher();
  expect(appels.charger).toHaveBeenCalledExactlyOnceWith("!equipe");
  expect(vue.container.textContent).toContain("!board");
  expect(vue.container.querySelector('[data-bibliotheque-liste="manquants"]')?.textContent).toBe("2spaces.libraryMissing");
  await vue.click('[data-bibliotheque-liste="invitations"]');
  expect(vue.container.querySelectorAll("[data-bibliotheque-membre]")).toHaveLength(1);
  expect(vue.container.querySelector("[data-bibliotheque-membre]")?.textContent).toContain("@attente:hs");
  await vue.click('[data-bibliotheque-liste="manquants"]');
  expect(vue.container.querySelectorAll("[data-bibliotheque-membre]")).toHaveLength(2);
  expect(vue.container.querySelector('[data-bibliotheque-liste="manquants"]')?.getAttribute("aria-expanded")).toBe("true");
});
it("ne propose pas de créer un salon pendant le chargement ou en cas d'erreur", async () => {
  let rejeter!: (e: Error) => void;
  appels.charger.mockReturnValueOnce(new Promise((_, reject) => { rejeter = reject; }));
  await afficher();
  expect(bouton("spaces.createLibrary")).toBeUndefined();
  await act(async () => rejeter(new Error("M_FORBIDDEN")));
  expect(bouton("spaces.createLibrary")).toBeUndefined();
  expect(vue.container.querySelector('[role="alert"]')?.textContent).toContain("M_FORBIDDEN");
  await vue.click('[aria-label="spaces.libraryRefresh"]');
  expect(vue.container.querySelector('[role="alert"]')).toBeNull();
  expect(vue.container.textContent).toContain("!board");
});
it.each([false, true])("la création invite les membres et reste désactivée en attendant /sync (échec partiel : %s)", async (partiel) => {
  acces.salon = null;
  appels.creer.mockResolvedValue({ roomId: "!nouveau", echecs: partiel ? ["@absent:hs"] : [] });
  await afficher();
  await act(async () => bouton("spaces.createLibrary").click());
  expect(appels.creer).toHaveBeenCalledExactlyOnceWith("!equipe");
  expect(bouton("spaces.createLibrary")).toBeUndefined();
  expect(vue.container.textContent).toContain("spaces.librarySyncing");
  if (partiel) expect(vue.container.querySelector('[role="alert"]')?.textContent).toContain("spaces.librarySyncPartial 1");
  acces.salon = "!nouveau";
  await vue.click('[aria-label="spaces.libraryRefresh"]');
  expect(vue.container.textContent).toContain("!nouveau");
  expect(vue.container.textContent).not.toContain("spaces.librarySyncing");
});
it("invite un membre depuis la liste et actualise les compteurs, puis invite les autres", async () => {
  await afficher(); await vue.click('[data-bibliotheque-liste="manquants"]');
  await vue.click('[data-bibliotheque-membre="@absent:hs"] button');
  expect(appels.inviter).toHaveBeenCalledExactlyOnceWith("!equipe", "!board", "@absent:hs");
  expect(vue.container.querySelector('[data-bibliotheque-liste="manquants"]')?.textContent).toBe("1spaces.libraryMissing");
  await act(async () => bouton("spaces.syncLibrary").click());
  expect(appels.inviter).toHaveBeenLastCalledWith("!equipe", "!board", undefined);
  expect(vue.container.querySelector('[data-bibliotheque-liste="invitations"]')?.textContent).toBe("3spaces.libraryPending");
  expect(bouton("spaces.syncLibrary").disabled).toBe(true);
});
it("signale les invitations partielles et conserve les membres à réessayer", async () => {
  appels.inviter.mockResolvedValue({ echecs: ["@absent:hs"], invitedCount: 1 });
  await afficher(); await act(async () => bouton("spaces.syncLibrary").click());
  expect(vue.container.querySelector('[role="alert"]')?.textContent).toContain("spaces.librarySyncPartial 1");
  expect(bouton("spaces.syncLibrary").disabled).toBe(false);
});
it("la confirmation peut être annulée par Échap sans fermer les paramètres ni expulser", async () => {
  await afficher(); await vue.click('[data-bibliotheque-membre="@alice:hs"] button');
  expect(vue.container.querySelector("form")?.textContent).toContain("spaces.libraryRemoveScope");
  await act(async () => vue.container.querySelector("form input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(vue.container.querySelector("form")).toBeNull();
  expect(appels.moderer).not.toHaveBeenCalled();
});
it.each([false, true])("expulse avec confirmation et motif, avec option de bannissement (%s)", async (ban) => {
  await afficher(); await vue.click('[data-bibliotheque-membre="@alice:hs"] button');
  await changerChamp('form input:not([type="checkbox"])', "abus");
  if (ban) await vue.click('form input[type="checkbox"]');
  expect(appels.moderer).not.toHaveBeenCalled();
  await act(async () => vue.container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(appels.moderer).toHaveBeenCalledExactlyOnceWith("!equipe", "!board", "@alice:hs", ban ? "bannir" : "expulser", "abus");
  expect(vue.container.querySelector("form")).toBeNull();
  expect(appels.busy.mock.calls).toEqual([[true], [false]]);
});
it("conserve la confirmation et le motif si le serveur refuse l'expulsion", async () => {
  appels.moderer.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
  await afficher(); await vue.click('[data-bibliotheque-membre="@alice:hs"] button');
  await changerChamp('form input:not([type="checkbox"])', "abus");
  await act(async () => vue.container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(vue.container.querySelector('[role="alert"]')?.textContent).toContain("M_FORBIDDEN");
  expect(vue.container.querySelector<HTMLInputElement>('form input:not([type="checkbox"])')?.value).toBe("abus");
});
it("permet de rétablir explicitement un exclu sans le mélanger aux invitations manquantes", async () => {
  await afficher(); await vue.click('[data-bibliotheque-liste="exclus"]');
  await vue.click('[data-bibliotheque-membre="@banni:hs"] button');
  expect(appels.moderer).toHaveBeenCalledExactlyOnceWith("!equipe", "!board", "@banni:hs", "retablir");
});
it("ne présente pas les actions quand les droits manquent", async () => {
  acces.administrateur = false; acces.peutInviter = false;
  acces.membres.forEach((m) => { m.peutExpulser = false; m.peutBannir = false; });
  await afficher();
  expect(bouton("spaces.syncLibrary")).toBeUndefined();
  expect(vue.container.querySelectorAll("[data-bibliotheque-membre] button")).toHaveLength(0);
});
it("ignore une réponse tardive après le passage à un autre espace", async () => {
  let repondre!: (valeur: AccesBibliotheque) => void;
  appels.charger.mockReturnValueOnce(new Promise((resolve) => { repondre = resolve; }));
  await afficher();
  acces.salon = "!boardB";
  await afficher("!autre");
  await act(async () => repondre({ ...acces, salon: "!boardA" }));
  expect(vue.container.textContent).toContain("!boardB");
  expect(vue.container.textContent).not.toContain("!boardA");
});
