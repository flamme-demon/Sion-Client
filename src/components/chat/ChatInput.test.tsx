import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
const contexte = vi.hoisted(() => ({ mobile: false, autorise: true, android: false }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => contexte.mobile }));
vi.mock("../../utils/plateforme", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../utils/plateforme")>(),
  get SUR_ANDROID() { return contexte.android; },
}));
vi.mock("../../services/frappe", () => ({ jEcris: vi.fn(), jArrete: vi.fn() }));
vi.mock("../../services/matrixService", () => ({ canSendMessage: () => contexte.autorise, getRoomMembers: () => [{ userId: "@bob:sion", displayName: "Bob", avatarUrl: null }] }));
vi.mock("./FilePreview", () => ({ FilePreview: () => null }));
vi.mock("./EmojiGridPanel", () => ({ EmojiGridPanel: () => null }));
vi.mock("./PollCreateModal", () => ({ PollCreateModal: ({ roomId, onClose }: { roomId: string; onClose: () => void }) => <div data-poll-room={roomId}><button onClick={onClose}>poll-close</button></div> }));
vi.mock("./ExternalVideoImport", () => ({ ExternalVideoImport: ({ onImported, onClose }: { onImported: (file: File) => void; onClose: () => void }) => <div data-video-import><button onClick={() => onImported(new File(["video"], "extrait.mp4", { type: "video/mp4" }))}>video-import</button><button onClick={onClose}>video-close</button></div> }));
vi.mock("./LargeMessageModal", () => ({ LargeMessageModal: () => null }));
const vue = montage();
const envoyer = vi.fn().mockResolvedValue(undefined);
const joindre = vi.fn();
beforeEach(() => {
  contexte.mobile = false; contexte.autorise = true; contexte.android = false; envoyer.mockClear(); joindre.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  useAppStore.setState({ activeChannel: "!salon", pendingFiles: [], editingMessage: null, replyingTo: null, kickMessage: null, addPendingFile: joindre });
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
  const envoyer = actions.querySelector('[aria-label="chat.send"]')!;
  expect(envoyer.textContent).toBe("");
  expect(envoyer.querySelector("svg")).not.toBeNull();
  expect(vue.container.querySelector('.sion-saisie-ligne [aria-label="chat.attachFile"]')).toBeNull();
  expect(vue.container.querySelector('.sion-saisie-ligne [aria-label="chat.gifTab"]')).toBeNull();
  expect(vue.container.querySelector('.sion-saisie-ligne [aria-label="chat.emojiTab"]')).not.toBeNull();
  expect(actions.querySelector('[aria-label="extVideo.menuItem"]')).not.toBeNull();
  expect(actions.querySelector('[aria-label="poll.menuItem"]')).not.toBeNull();
  expect(vue.container.querySelector('[aria-label="chat.insertLink"]')).toBeNull();
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
it("ajuste la hauteur aux retours à la ligne, la plafonne puis la réduit sans relire scrollHeight", async () => {
  let redimensionner!: ResizeObserverCallback;
  const observer = { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { redimensionner = callback; }
    observe = observer.observe;
    disconnect = observer.disconnect;
  });
  await vue.render(<ChatInput />);
  const textarea = vue.container.querySelector("textarea")!;
  const lectureHauteur = vi.spyOn(textarea, "scrollHeight", "get");
  const champ = vue.container.querySelector<HTMLElement>(".sion-saisie-champ")!;
  const mesure = vue.container.querySelector(".sion-saisie-mesure")!;
  expect(observer.observe).toHaveBeenCalledWith(mesure);
  expect(mesure.getAttribute("aria-hidden")).toBe("true");
  const hauteur = (blockSize: number) => redimensionner([
    { borderBoxSize: [{ blockSize }], target: mesure } as unknown as ResizeObserverEntry,
  ], observer);
  await saisir("Première ligne\nDeuxième ligne\n");
  hauteur(79);
  expect(champ.style.getPropertyValue("--sion-saisie-hauteur")).toBe("79px");
  hauteur(240);
  expect(champ.style.getPropertyValue("--sion-saisie-hauteur")).toBe("120px");
  await saisir("");
  hauteur(37);
  expect(champ.style.getPropertyValue("--sion-saisie-hauteur")).toBe("37px");
  expect(lectureHauteur).not.toHaveBeenCalled();
  await vue.render(null);
  expect(observer.disconnect).toHaveBeenCalledOnce();
});
it("@ insère une mention et propose les membres", async () => {
  await vue.render(<ChatInput />);
  await vue.click('[aria-label="chat.mention"]');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(vue.container.querySelector("textarea")!.value).toBe("@");
  expect(vue.container.textContent).toContain("Bob");
});
it("la vidéo ouvre l'importeur existant et ajoute le fichier au brouillon", async () => {
  await vue.render(<ChatInput />);
  await saisir("Mon extrait");
  await vue.click('[aria-label="extVideo.menuItem"]');
  expect(vue.container.querySelector('[data-video-import]')).not.toBeNull();
  await vue.click('[data-video-import] button');
  expect(joindre).toHaveBeenCalledWith(expect.objectContaining({ name: "extrait.mp4", type: "video/mp4" }));
  expect(vue.container.querySelector('[data-video-import]')).toBeNull();
  expect(vue.container.querySelector("textarea")!.value).toBe("Mon extrait");
  expect(envoyer).not.toHaveBeenCalled();
});
it("le sondage ouvre sa fenêtre pour le salon courant et se ferme", async () => {
  await vue.render(<ChatInput />);
  await vue.click('[aria-label="poll.menuItem"]');
  expect(vue.container.querySelector('[data-poll-room]')?.getAttribute("data-poll-room")).toBe("!salon");
  await vue.click('[data-poll-room] button');
  expect(vue.container.querySelector('[data-poll-room]')).toBeNull();
});
it("le trombone ouvre directement le sélecteur de fichiers", async () => {
  await vue.render(<ChatInput />);
  const input = vue.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const ouvrir = vi.spyOn(input, "click");
  await vue.click('[aria-label="chat.attachFile"]');
  expect(ouvrir).toHaveBeenCalledOnce();
  expect(vue.container.textContent).not.toContain("chat.attachFileItem");
});
it("un salon en lecture seule désactive la saisie et les nouvelles actions", async () => {
  contexte.autorise = false;
  await vue.render(<ChatInput />);
  expect(vue.container.querySelector("textarea")!.disabled).toBe(true);
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.mention"]')!.disabled).toBe(true);
  for (const label of ["extVideo.menuItem", "chat.attachFile", "poll.menuItem"]) {
    expect(vue.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.disabled).toBe(true);
    await vue.click(`[aria-label="${label}"]`);
  }
  expect(vue.container.querySelector('[data-video-import], [data-poll-room]')).toBeNull();
});
it("Android ne propose pas l'import vidéo par yt-dlp, même en largeur desktop", async () => {
  contexte.android = true;
  await vue.render(<ChatInput />);
  expect(vue.container.querySelector('[aria-label="extVideo.menuItem"]')).toBeNull();
  expect(vue.container.querySelector('[aria-label="poll.menuItem"]')).not.toBeNull();
});
it("le téléphone conserve la saisie sur une ligne", async () => {
  contexte.mobile = true;
  await vue.render(<ChatInput />);
  expect(vue.container.querySelector(".sion-saisie-actions")).toBeNull();
  expect(vue.container.querySelector("textarea")).not.toBeNull();
  expect(vue.container.querySelector('[aria-label="chat.send"]')?.textContent).toBe("");
  await vue.click('[aria-label="chat.attachFile"]');
  expect(vue.container.textContent).toContain("chat.attachFileItem");
  expect(vue.container.textContent).toContain("poll.menuItem");
});
