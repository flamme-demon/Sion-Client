import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
const contexte = vi.hoisted(() => ({ mobile: false, autorise: true }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => contexte.mobile }));
vi.mock("../../services/frappe", () => ({ jEcris: vi.fn(), jArrete: vi.fn() }));
vi.mock("../../services/matrixService", () => ({ canSendMessage: () => contexte.autorise, getRoomMembers: () => [{ userId: "@bob:sion", displayName: "Bob", avatarUrl: null }] }));
vi.mock("./FilePreview", () => ({ FilePreview: () => null }));
vi.mock("./EmojiGridPanel", () => ({ EmojiGridPanel: () => null }));
vi.mock("./PollCreateModal", () => ({ PollCreateModal: () => null }));
vi.mock("./LargeMessageModal", () => ({ LargeMessageModal: () => null }));
const vue = montage();
const envoyer = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  contexte.mobile = false; contexte.autorise = true; envoyer.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  useAppStore.setState({ activeChannel: "!salon", pendingFiles: [], editingMessage: null, replyingTo: null, kickMessage: null });
  useMatrixStore.setState({ channels: [], sendMessage: envoyer });
});
async function saisir(texte: string) {
  const input = vue.container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, texte);
    input.setSelectionRange(texte.length, texte.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("la saisie précède la rangée d'actions sur deux lignes", async () => {
  await vue.render(<ChatInput />);
  const textarea = vue.container.querySelector("textarea")!;
  const actions = vue.container.querySelector(".sion-saisie-actions")!;
  expect(textarea.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(actions.querySelector('[aria-label="chat.send"]')?.textContent).toBe("chat.send");
});
it("Envoyer est désactivé à vide, envoie le texte puis revient à vide", async () => {
  await vue.render(<ChatInput />);
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.send"]')!.disabled).toBe(true);
  await saisir("Bonjour");
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.send"]')!.disabled).toBe(false);
  await vue.click('[aria-label="chat.send"]');
  expect(envoyer).toHaveBeenCalledWith("!salon", "Bonjour");
  expect(vue.container.querySelector("textarea")!.value).toBe("");
});
it("@ insère une mention et propose les membres", async () => {
  await vue.render(<ChatInput />);
  await vue.click('[aria-label="chat.mention"]');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(vue.container.querySelector("textarea")!.value).toBe("@");
  expect(vue.container.textContent).toContain("Bob");
});
it("le lien insère du Markdown éditable et sélectionne l'URL", async () => {
  await vue.render(<ChatInput />);
  await vue.click('[aria-label="chat.insertLink"]');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  const textarea = vue.container.querySelector("textarea")!;
  expect(textarea.value).toBe("[chat.linkText](https://)");
  expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe("https://");
});
it("un salon en lecture seule désactive la saisie et les nouvelles actions", async () => {
  contexte.autorise = false;
  await vue.render(<ChatInput />);
  expect(vue.container.querySelector("textarea")!.disabled).toBe(true);
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.mention"]')!.disabled).toBe(true);
});
it("le téléphone conserve la saisie sur une ligne", async () => {
  contexte.mobile = true;
  await vue.render(<ChatInput />);
  expect(vue.container.querySelector(".sion-saisie-actions")).toBeNull();
  expect(vue.container.querySelector("textarea")).not.toBeNull();
  expect(vue.container.querySelector('[aria-label="chat.send"]')?.textContent).toBe("");
});
