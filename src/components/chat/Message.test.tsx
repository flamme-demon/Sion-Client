import { montage } from "../../test/interface";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Message } from "./Message";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import type { ChatMessage } from "../../types/matrix";

const serveur = vi.hoisted(() => ({
  pouvoir: 0, natif: true, epingles: [] as string[],
  supprimer: vi.fn(), epingler: vi.fn(), reagir: vi.fn(), retirerReaction: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => serveur.natif }));
vi.mock("../../services/matrixService", () => ({
  getUserPowerLevel: () => serveur.pouvoir, getStatePowerLevel: () => 50, getMemberPowerLevel: () => 0,
  getPinnedEventIds: () => serveur.epingles, pinMessage: serveur.epingler,
  sendReaction: serveur.reagir, redactMessage: serveur.retirerReaction,
}));
vi.mock("./MarkdownRenderer", () => ({ MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span> }));
vi.mock("./EmojiGridPanel", () => ({ EmojiGridPanel: ({ onPick }: { onPick: (emoji: string) => void }) => <button onClick={() => onPick("😂")}>rire</button> }));
vi.mock("./ModaleSignalement", () => ({ ModaleSignalement: ({ eventId }: { eventId: string }) => <div role="dialog">{eventId}</div> }));

const vue = montage();
const message: ChatMessage = { id: "$message", eventId: "$message", senderId: "@alice:sion.test", user: "Alice", role: "user", time: "12:00", text: "Bonjour" };
let instant = 1000;
beforeEach(() => {
  vi.clearAllMocks();
  // Les clics droits ne sont pas les clics synthétiques d'un appui long.
  vi.spyOn(performance, "now").mockReturnValue(instant += 1000);
  serveur.pouvoir = 0;
  serveur.natif = true;
  serveur.epingles = [];
  useMatrixStore.setState({ currentUserId: "@moi:sion.test", deleteMessage: serveur.supprimer, pinnedVersion: 0 });
  useAppStore.setState({ activeChannel: "!salon", replyingTo: null, editingMessage: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const rendre = async (own = false) => {
  await vue.render(<Message message={own ? { ...message, senderId: "@moi:sion.test" } : message} showHeader={false} isFirst />);
};
const bulle = () => vue.container.querySelector<HTMLElement>(".sion-message-bulle")!;
const ouvrir = async () => {
  await act(async () => { bulle().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 120 })); });
};
const menu = () => document.querySelector(".sion-menu-message");
const libelles = () => Array.from(menu()?.querySelectorAll("button") ?? []).map((button) => button.textContent);
const choisir = async (label: string) => {
  const button = Array.from(menu()?.querySelectorAll("button") ?? []).find((item) => item.textContent === label)!;
  await act(async () => button.click());
};

it("seuls Réagir et Répondre restent visibles et fonctionnent", async () => {
  serveur.pouvoir = 100;
  await rendre(true);
  expect(Array.from(vue.container.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"))).toEqual(["chat.react", "chat.reply"]);
  await vue.click('[aria-label="chat.reply"]');
  expect(useAppStore.getState().replyingTo?.eventId).toBe("$message");
  await act(async () => { vue.container.querySelector('[aria-label="chat.react"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  await act(async () => { Array.from(vue.container.querySelectorAll("button")).find((button) => button.textContent === "rire")!.click(); });
  expect(serveur.reagir).toHaveBeenCalledWith("!salon", "$message", "😂");
});

it("un membre peut signaler un message tiers, sans le supprimer ni l'épingler", async () => {
  await rendre();
  await ouvrir();
  expect(libelles()).toEqual(["report.action"]);
  expect(vue.container.contains(menu())).toBe(false);
  await choisir("report.action");
  expect(menu()).toBeNull();
  expect(vue.container.querySelector('[role="dialog"]')?.textContent).toBe("$message");
});

it("le menu de ses propres messages permet de modifier et demande confirmation avant suppression", async () => {
  await rendre(true);
  await ouvrir();
  expect(libelles()).toEqual(["chat.editMessage", "chat.deleteMessage"]);
  await choisir("chat.editMessage");
  expect(useAppStore.getState().editingMessage).toEqual({ eventId: "$message", text: "Bonjour" });
  await ouvrir();
  await choisir("chat.deleteMessage");
  expect(serveur.supprimer).not.toHaveBeenCalled();
  await choisir("auth.cancel");
  expect(serveur.supprimer).not.toHaveBeenCalled();
  await choisir("chat.deleteMessage");
  await choisir("chat.deleteMessageConfirm");
  expect(serveur.supprimer).toHaveBeenCalledExactlyOnceWith("!salon", "$message");
  expect(menu()).toBeNull();
});

it("un modérateur peut désépingler et supprimer un message tiers", async () => {
  serveur.pouvoir = 50;
  serveur.epingles = ["$message"];
  await rendre();
  await ouvrir();
  expect(libelles()).toEqual(["chat.unpinMessage", "report.action", "chat.deleteMessage"]);
  expect(menu()?.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-checked")).toBe("true");
  await choisir("chat.unpinMessage");
  expect(serveur.epingler).toHaveBeenCalledWith("!salon", "$message");
  await ouvrir();
  await choisir("chat.deleteMessage");
  await choisir("chat.deleteMessageConfirm");
  expect(serveur.supprimer).toHaveBeenCalledWith("!salon", "$message");
});

it("le menu s'ouvre et se parcourt au clavier ; Échap rend le focus au message", async () => {
  await rendre(true);
  await act(async () => { bulle().focus(); bulle().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true })); });
  expect(document.activeElement?.textContent).toBe("chat.editMessage");
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })); });
  expect(document.activeElement?.textContent).toBe("chat.deleteMessage");
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(bulle());
});

it("un clic extérieur ou le défilement du chat ferme le menu", async () => {
  await rendre(true);
  await ouvrir();
  await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(menu()).toBeNull();
  await ouvrir();
  await act(async () => { vue.container.dispatchEvent(new Event("scroll")); });
  expect(menu()).toBeNull();
});

it("le menu d'une pièce jointe garde la priorité sur celui du message", async () => {
  await rendre(true);
  const texte = bulle().querySelector("span")!;
  texte.addEventListener("contextmenu", (event) => event.preventDefault());
  await act(async () => { texte.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect(menu()).toBeNull();
});

it("un appui long ouvre les actions sur téléphone", async () => {
  vi.useFakeTimers();
  await rendre(true);
  const event = new Event("touchstart", { bubbles: true });
  Object.defineProperty(event, "touches", { value: [{ clientX: 180, clientY: 100 }] });
  await act(async () => { bulle().dispatchEvent(event); vi.advanceTimersByTime(500); });
  expect(libelles()).toEqual(["chat.editMessage", "chat.deleteMessage"]);
});
