import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "../../types/matrix";

const serveur = vi.hoisted(() => ({ supprimer: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => null }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => true }));
vi.mock("../../services/matrixCore", () => ({ marquerLu: vi.fn() }));
vi.mock("../../services/matrixService", () => ({
  getUserPowerLevel: () => 0, getStatePowerLevel: () => 50, getRedactPowerLevel: () => 50, getMemberPowerLevel: () => 0,
  getPinnedEventIds: () => [], redactMessage: serveur.supprimer,
}));
vi.mock("./MarkdownRenderer", () => ({ MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span> }));
const vue = montage();
const message = (id: string): ChatMessage => ({ id, eventId: id, senderId: "@moi:hs", user: "Moi", role: "user", text: "Texte", time: "12:00", ts: Date.now() });
beforeEach(() => {
  vi.clearAllMocks(); serveur.supprimer.mockResolvedValue(undefined);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useMatrixStore.setState({ currentUserId: "@moi:hs", messages: { "!A": [message("$1"), message("$2"), message("$3")], "!B": [message("$autre")] }, roomHasMore: { "!A": false, "!B": false }, roomLoadingHistory: {} });
  useAppStore.setState({ activeChannel: "!A", lastReadMessageId: {}, mobileView: "chat", scrollToMessageId: null });
});
const selectionner = async () => {
  await act(async () => { vue.container.querySelector('[data-event-id="$1"] .sion-message-bulle')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 150, clientY: 100 })); });
  await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('.sion-menu-message button')).find((b) => b.textContent === "chat.selectMessage")!.click(); });
};

it("sélectionne plusieurs messages et ne supprime que ceux confirmés", async () => {
  await vue.render(<MessageList />); await selectionner();
  await act(async () => { vue.container.querySelector<HTMLElement>('[data-event-id="$2"] .sion-message-bulle')!.click(); });
  expect(vue.container.querySelectorAll('.sion-case-selection[aria-pressed="true"]')).toHaveLength(2);
  await vue.click('[aria-label="chat.deleteSelected"]');
  expect(serveur.supprimer).not.toHaveBeenCalled();
  await vue.click('[data-confirmer-suppression]');
  expect(serveur.supprimer.mock.calls).toEqual([["!A", "$1"], ["!A", "$2"]]);
  expect(vue.container.querySelector('[data-selection-messages]')).toBeNull();
  expect(useMatrixStore.getState().messages["!A"].map((m) => m.id)).toEqual(["$3"]);
});
it("un aller-retour entre salons ne restaure pas une ancienne sélection", async () => {
  await vue.render(<MessageList />); await selectionner();
  await act(async () => { useAppStore.setState({ activeChannel: "!B" }); });
  await act(async () => { useAppStore.setState({ activeChannel: "!A" }); });
  expect(vue.container.querySelector('[data-selection-messages]')).toBeNull();
  expect(serveur.supprimer).not.toHaveBeenCalled();
});
it("un changement de compte annule la sélection", async () => {
  await vue.render(<MessageList />); await selectionner();
  await act(async () => { useMatrixStore.setState({ currentUserId: "@nouveau:hs" }); });
  expect(vue.container.querySelector('[data-selection-messages]')).toBeNull();
});
