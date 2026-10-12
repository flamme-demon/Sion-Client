import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { ParcourirSalonsEspace } from "./ParcourirSalonsEspace";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import type { SalonDecouvrable } from "../../services/espacesService";
import type { Channel } from "../../types/matrix";

const appels = vi.hoisted(() => ({ decouvrir: vi.fn(), rejoindre: vi.fn(), choisir: vi.fn() }));
vi.mock("../../i18n", () => ({ default: { t: (cle: string) => cle } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string) => cle }) }));
vi.mock("../../hooks/useEspaces", () => ({ choisirEspace: appels.choisir }));
vi.mock("../../services/espacesService", () => ({ decouvrirSalonsEspace: appels.decouvrir, rejoindreAvecVia: appels.rejoindre }));
const vue = montage();
const salon = (id: string, name: string, suite: Partial<SalonDecouvrable> = {}): SalonDecouvrable => ({ room_id: id, name, via: ["matrix.org", "kde.org"], suggested: false, ...suite });
const catalogue = [salon("!fr", "Manjaro (French)"), salon("!general", "Manjaro", { suggested: true }), salon("!deja", "Déjà membre")];
const ch = (id: string, suite: Partial<Channel> = {}): Channel => ({ id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, membership: "join", ...suite });
const bouton = (cle: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((v) => v.textContent === cle)!;
const cocher = async (id: string) => act(async () => document.querySelector<HTMLInputElement>(`[data-decouverte-salon="${id}"] input`)!.click());
beforeEach(() => {
  appels.decouvrir.mockReset().mockResolvedValue(catalogue);
  appels.rejoindre.mockReset().mockResolvedValue("!fr");
  appels.choisir.mockReset();
  useMatrixStore.setState({ currentUserId: "@moi:hs", channels: [ch("!A", { isSpace: true, name: "Manjaro Linux Community Space" }), ch("!deja")] });
  useEspacesStore.setState({ espaceActif: "!A", fenetre: "parcourir", hierarchies: {} });
});
it("présente les salons sans join_rule et distingue les adhésions existantes, sans aucune inscription", async () => {
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Manjaro (French)");
  expect(document.querySelector<HTMLInputElement>('[data-decouverte-salon="!deja"] input')?.disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[data-decouverte-salon="!fr"] input')?.checked).toBe(false);
  expect(appels.rejoindre).not.toHaveBeenCalled();
});
it("n'inscrit que les salons cochés avec leurs serveurs de routage", async () => {
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  await cocher("!fr");
  await act(async () => bouton("spaces.joinSelectedRooms").click());
  expect(appels.rejoindre.mock.calls).toEqual([["!fr", ["matrix.org", "kde.org"]]]);
  expect(appels.choisir).toHaveBeenCalledExactlyOnceWith("!A");
  expect(useEspacesStore.getState().fenetre).toBeNull();
});
it("conserve les échecs sélectionnés et ne réinscrit pas les salons ayant réussi", async () => {
  appels.rejoindre.mockImplementation(async (id: string) => { if (id === "!general") throw new Error("M_FORBIDDEN"); return id; });
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  await cocher("!fr"); await cocher("!general");
  await act(async () => bouton("spaces.joinSelectedRooms").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Manjaro : M_FORBIDDEN");
  expect(useEspacesStore.getState().fenetre).toBe("parcourir");
  expect(document.querySelector<HTMLInputElement>('[data-decouverte-salon="!fr"] input')?.checked).toBe(false);
  expect(document.querySelector<HTMLInputElement>('[data-decouverte-salon="!general"] input')?.checked).toBe(true);
  appels.rejoindre.mockClear().mockResolvedValue("!general");
  await act(async () => bouton("spaces.joinSelectedRooms").click());
  expect(appels.rejoindre).toHaveBeenCalledExactlyOnceWith("!general", ["matrix.org", "kde.org"]);
});
it("explore un sous-espace et garde la sélection après retour sans y adhérer", async () => {
  appels.decouvrir.mockImplementation(async (id: string) => id === "!A"
    ? [...catalogue, salon("!sous", "Langues", { room_type: "m.space" })] : [salon("!enfant", "Salon du sous-espace")]);
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  await cocher("!fr");
  await act(async () => document.querySelector<HTMLButtonElement>('[data-decouverte-espace="!sous"]')!.click());
  await cocher("!enfant");
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-decouverte-chemin button')!.click());
  expect(document.querySelector<HTMLInputElement>('[data-decouverte-salon="!fr"] input')?.checked).toBe(true);
  expect(appels.rejoindre).not.toHaveBeenCalled();
  await act(async () => bouton("spaces.joinSelectedRooms").click());
  expect(appels.rejoindre.mock.calls.map(([id]) => id)).toEqual(["!fr", "!enfant"]);
});
it("ignore une réponse tardive du sous-espace après retour au parent", async () => {
  let finir!: (v: SalonDecouvrable[]) => void;
  const retard = new Promise<SalonDecouvrable[]>((r) => { finir = r; });
  appels.decouvrir.mockImplementation((id: string) => id === "!sous" ? retard : Promise.resolve([...catalogue, salon("!sous", "Langues", { room_type: "m.space" })]));
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-decouverte-espace="!sous"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-decouverte-chemin button')!.click());
  await act(async () => finir([salon("!retard", "Mauvais niveau")]));
  expect(document.querySelector('[data-decouverte-salon="!fr"]')).not.toBeNull();
  expect(document.querySelector('[data-decouverte-salon="!retard"]')).toBeNull();
});
it("permet de relancer une lecture échouée", async () => {
  appels.decouvrir.mockRejectedValueOnce(new Error("Indisponible"));
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Indisponible");
  await act(async () => bouton("spaces.retryRooms").click());
  expect(document.querySelector('[data-decouverte-salon="!fr"]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it("un double clic ne déclenche pas deux inscriptions et bloque la fermeture pendant l'envoi", async () => {
  let finir!: (id: string) => void;
  appels.rejoindre.mockImplementationOnce(() => new Promise<string>((r) => { finir = r; }));
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  await cocher("!fr");
  await act(async () => { bouton("spaces.joinSelectedRooms").click(); bouton("spaces.joinSelectedRooms").click(); });
  expect(appels.rejoindre).toHaveBeenCalledTimes(1);
  expect(document.querySelector<HTMLButtonElement>('button[aria-label="chat.close"]')?.disabled).toBe(true);
  await act(async () => finir("!fr"));
  expect(useEspacesStore.getState().fenetre).toBeNull();
});
it("fermer pendant la lecture ne provoque aucune inscription ni retour de fenêtre", async () => {
  let finir!: (v: SalonDecouvrable[]) => void;
  appels.decouvrir.mockImplementationOnce(() => new Promise<SalonDecouvrable[]>((r) => { finir = r; }));
  await vue.render(<ParcourirSalonsEspace espaceId="!A" />);
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="chat.close"]')!.click());
  await vue.render(null);
  await act(async () => finir(catalogue));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useEspacesStore.getState().fenetre).toBeNull();
  expect(appels.rejoindre).not.toHaveBeenCalled();
});
