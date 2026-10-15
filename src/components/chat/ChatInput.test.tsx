import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
const contexte = vi.hoisted(() => ({ mobile: false, autorise: true, android: false, lirePressePapiers: vi.fn() }));
vi.mock("../../utils/clipboardImage", () => ({ readClipboardFiles: contexte.lirePressePapiers }));
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
const envoyerFichier = vi.fn().mockResolvedValue(undefined);
const editer = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  contexte.mobile = false; contexte.autorise = true; contexte.android = false; envoyer.mockReset().mockResolvedValue(undefined); joindre.mockClear();
  contexte.lirePressePapiers.mockReset().mockResolvedValue([]);
  envoyerFichier.mockClear();
  editer.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  useAppStore.setState({ activeChannel: "!salon", pendingFiles: [], editingMessage: null, replyingTo: null, kickMessage: null, fileError: null, addPendingFile: joindre });
  useMatrixStore.setState({ channels: [], sendMessage: envoyer, sendFile: envoyerFichier, editMessage: editer });
});
async function saisir(texte: string) {
  const input = vue.container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, texte);
    input.setSelectionRange(texte.length, texte.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("keeps a caption edit and its draft when the original message cannot be read", async () => {
  editer.mockRejectedValue(new Error("Message original indéchiffrable"));
  useAppStore.setState({ editingMessage: { eventId: "$photo", text: "old caption" } });
  await vue.render(<ChatInput />);
  await saisir("Quel fumier ce chat !");
  await vue.click('[aria-label="chat.send"]');
  expect(editer).toHaveBeenCalledWith("!salon", "$photo", "Quel fumier ce chat !");
  expect(vue.container.querySelector("textarea")!.value).toBe("Quel fumier ce chat !");
  expect(useAppStore.getState().editingMessage?.eventId).toBe("$photo");
  expect(useAppStore.getState().fileError).toBe("Message original indéchiffrable");
});
it("does not send duplicate edits while loading the original attachment", async () => {
  let finish!: () => void;
  editer.mockImplementation(() => new Promise<void>((done) => { finish = done; }));
  useAppStore.setState({ editingMessage: { eventId: "$photo", text: "caption" } });
  await vue.render(<ChatInput />);
  await vue.click('[aria-label="chat.send"]');
  await act(async () => {
    vue.container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(editer).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(useAppStore.getState().editingMessage).toBeNull();
});
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
it("un envoi lent bloque les doubles envois et conserve le nouveau brouillon", async () => {
  let confirmer!: () => void;
  envoyer.mockImplementation(() => new Promise<void>((resolve) => { confirmer = resolve; }));
  await vue.render(<ChatInput />);
  await saisir("https://store.steampowered.com/app/4536610/City_Masterplan/");
  await vue.click('[aria-label="chat.send"]');
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.send"]')!.disabled).toBe(true);
  await act(async () => {
    vue.container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(envoyer).toHaveBeenCalledOnce();
  await saisir("Mon message suivant");
  await act(async () => confirmer());
  expect(vue.container.querySelector("textarea")!.value).toBe("Mon message suivant");
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.send"]')!.disabled).toBe(false);
});
it("un envoi échoué affiche l'erreur et garde le texte pour réessayer", async () => {
  envoyer.mockRejectedValue(new Error("hors ligne"));
  await vue.render(<ChatInput />);
  await saisir("Lien à réessayer");
  await vue.click('[aria-label="chat.send"]');
  expect(vue.container.querySelector("textarea")!.value).toBe("Lien à réessayer");
  expect(vue.container.textContent).toContain("hors ligne");
  expect(vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.send"]')!.disabled).toBe(false);
});
it("une reprise ne renvoie pas un fichier déjà transmis avant l'échec du texte", async () => {
  const file = new File(["image"], "photo.png", { type: "image/png" });
  useAppStore.setState({ pendingFiles: [{ id: "photo", file, name: file.name, size: file.size, mimeType: file.type }] });
  useAppStore.setState({ replyingTo: { eventId: "$origine", senderId: "@alice:sion", user: "Alice", text: "salut" } });
  const repondre = vi.fn().mockRejectedValue(new Error("hors ligne"));
  useMatrixStore.setState({ sendReply: repondre });
  await vue.render(<ChatInput />);
  await saisir("Mon texte");
  await vue.click('[aria-label="chat.send"]');
  expect(envoyerFichier).toHaveBeenCalledOnce();
  expect(useAppStore.getState().pendingFiles).toEqual([]);
  expect(vue.container.querySelector("textarea")!.value).toBe("Mon texte");
  repondre.mockResolvedValue(undefined);
  await vue.click('[aria-label="chat.send"]');
  expect(envoyerFichier).toHaveBeenCalledOnce();
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

async function coller({ texte = "", uris = "", files = [] }: { texte?: string; uris?: string; files?: File[] } = {}) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
    getData: (type: string) => type === "text/plain" ? texte : type === "text/uri-list" ? uris : "",
  } });
  await act(async () => { vue.container.querySelector("textarea")!.dispatchEvent(event); });
  return event;
}

it("colle les images de l’explorateur dans le brouillon sans insérer leurs chemins ni envoyer", async () => {
  const files = [new File(["image"], "photo.png", { type: "image/png" }), new File(["gif"], "anim.gif", { type: "image/gif" })];
  contexte.lirePressePapiers.mockResolvedValue(files);
  await vue.render(<ChatInput />);
  await saisir("Mes photos");
  const event = await coller({ texte: "file:///tmp/photo.png", uris: "file:///tmp/photo.png\r\nfile:///tmp/anim.gif\r\n" });
  expect(event.defaultPrevented).toBe(true);
  expect(joindre.mock.calls.map(([file]) => file.name)).toEqual(["photo.png", "anim.gif"]);
  expect(vue.container.querySelector("textarea")!.value).toBe("Mes photos");
  expect(envoyer).not.toHaveBeenCalled();
});

it("privilégie les fichiers du navigateur pour éviter des images en double", async () => {
  await vue.render(<ChatInput />);
  const image = new File(["image"], "capture.png", { type: "image/png" });
  expect((await coller({ files: [image] })).defaultPrevented).toBe(true);
  expect(joindre).toHaveBeenCalledExactlyOnceWith(image);
  expect(contexte.lirePressePapiers).not.toHaveBeenCalled();
});

it("laisse le collage normal du texte et des liens", async () => {
  await vue.render(<ChatInput />);
  const event = await coller({ texte: "https://example.test/image.png", uris: "https://example.test/image.png" });
  expect(event.defaultPrevented).toBe(false);
  expect(joindre).not.toHaveBeenCalled();
});

it("ne colle pas dans un autre salon si la lecture du presse-papiers finit après la navigation", async () => {
  let terminer!: (files: File[]) => void;
  contexte.lirePressePapiers.mockImplementation(() => new Promise<File[]>((resolve) => { terminer = resolve; }));
  await vue.render(<ChatInput />);
  await coller();
  await act(async () => {
    useAppStore.setState({ activeChannel: "!autre-salon" });
    terminer([new File(["image"], "capture.png", { type: "image/png" })]);
  });
  expect(joindre).not.toHaveBeenCalled();
});

it.each([1, 3])("envoie le texte comme légende de la première pièce jointe, sans message séparé (%i images)", async (count) => {
  const files = Array.from({ length: count }, (_, i) => new File(["image"], `photo${i}.png`, { type: "image/png" }));
  useAppStore.setState({ pendingFiles: files.map((file, i) => ({ id: String(i), file, name: file.name, size: file.size, mimeType: file.type })) });
  await vue.render(<ChatInput />);
  await saisir("Pour avoir la bêta !");
  await vue.click('[aria-label="chat.send"]');
  expect(envoyerFichier.mock.calls).toEqual(files.map((file, i) => i === 0 ? ["!salon", file, "Pour avoir la bêta !"] : ["!salon", file]));
  expect(envoyer).not.toHaveBeenCalled();
  expect(useAppStore.getState().pendingFiles).toHaveLength(0);
  expect(vue.container.querySelector("textarea")!.value).toBe("");
});
