import { montage } from "../../test/interface";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Message } from "./Message";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import type { ChatMessage } from "../../types/matrix";
import { SelectionMessagesContext } from "./selectionMessages";

const serveur = vi.hoisted(() => ({
  pouvoir: 0, redact: 50, natif: true, epingles: [] as string[],
  supprimer: vi.fn(), epingler: vi.fn(), reagir: vi.fn(), retirerReaction: vi.fn(),
  dechiffrer: vi.fn(),
  affiche: vi.fn(),
}));
vi.mock("../../services/voiceNativeService", () => ({ afficheLecteurVideo: serveur.affiche }));
vi.mock("../../utils/decryptMedia", () => ({ createDecryptedObjectUrl: serveur.dechiffrer }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => serveur.natif }));
vi.mock("../../services/matrixService", () => ({
  getUserPowerLevel: () => serveur.pouvoir, getStatePowerLevel: () => 50, getMemberPowerLevel: () => 0,
  getRedactPowerLevel: () => serveur.redact,
  getPinnedEventIds: () => serveur.epingles, pinMessage: serveur.epingler,
  sendReaction: serveur.reagir, redactMessage: serveur.retirerReaction,
}));
vi.mock("./MarkdownRenderer", () => ({ MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span> }));
vi.mock("./EmojiGridPanel", () => ({ EmojiGridPanel: ({ onPick }: { onPick: (emoji: string) => void }) => <><input aria-label="Rechercher un emoji" /><button onClick={() => onPick("😂")}>rire</button></> }));
vi.mock("./ModaleSignalement", () => ({ ModaleSignalement: ({ eventId }: { eventId: string }) => <div role="dialog">{eventId}</div> }));

const vue = montage();
const message: ChatMessage = { id: "$message", eventId: "$message", senderId: "@alice:sion.test", user: "Alice", role: "user", time: "12:00", text: "Bonjour" };
let instant = 1000;
beforeEach(() => {
  vi.clearAllMocks();
  // Les clics droits ne sont pas les clics synthétiques d'un appui long.
  vi.spyOn(performance, "now").mockReturnValue(instant += 1000);
  serveur.pouvoir = 0;
  serveur.redact = 50;
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
const boutonReaction = () => vue.container.querySelector<HTMLButtonElement>('[aria-label="chat.react"]')!;

const video = (thumbnailUrl?: string): ChatMessage => ({ ...message, text: "", msgtype: "m.video", attachments: [{
  id: "$video", name: "clip.webm", mimeType: "video/webm", size: 19_749_104,
  url: "https://sion.test/video", thumbnailUrl, width: 1920, height: 1080,
}] });
function imagesVisibles() {
  vi.stubGlobal("IntersectionObserver", class {
    callback: (entrees: { isIntersecting: boolean }[]) => void;
    constructor(callback: (entrees: { isIntersecting: boolean }[]) => void) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
}

it("affiche la miniature jointe à une vidéo sans charger le fichier vidéo", async () => {
  imagesVisibles();
  const charger = vi.fn();
  vi.stubGlobal("fetch", charger);
  await vue.render(<Message message={video("https://sion.test/preview.jpg")} showHeader={false} isFirst />);
  expect(vue.container.querySelector('img[alt="clip.webm"]')?.getAttribute("src")).toBe("https://sion.test/preview.jpg");
  expect(serveur.affiche).not.toHaveBeenCalled();
  expect(charger).not.toHaveBeenCalled();
});

it("une miniature arrivée après la carte remplace l'extraction encore en attente", async () => {
  imagesVisibles();
  let terminer!: (s: string) => void;
  serveur.affiche.mockReturnValue(new Promise((resolve) => { terminer = resolve; }));
  await vue.render(<Message message={video()} showHeader={false} isFirst />);
  expect(serveur.affiche).toHaveBeenCalledOnce();
  await vue.render(<Message message={video("https://sion.test/preview.jpg")} showHeader={false} isFirst />);
  await act(async () => terminer("data:image/jpeg;base64,ancienne"));
  expect(vue.container.querySelector('img[alt="clip.webm"]')?.getAttribute("src")).toBe("https://sion.test/preview.jpg");
});

it("une miniature indisponible retrouve l'extraction locale des anciennes vidéos", async () => {
  imagesVisibles();
  serveur.affiche.mockResolvedValue("data:image/jpeg;base64,locale");
  await vue.render(<Message message={video("https://sion.test/preview.jpg")} showHeader={false} isFirst />);
  await act(async () => vue.container.querySelector('img[alt="clip.webm"]')!.dispatchEvent(new Event("error")));
  expect(serveur.affiche).toHaveBeenCalledExactlyOnceWith("https://sion.test/video");
  expect(vue.container.querySelector('img[alt="clip.webm"]')?.getAttribute("src")).toBe("data:image/jpeg;base64,locale");
});
const selecteurReaction = () => document.querySelector<HTMLDivElement>(".sion-reactions-picker");
const ouvrirReactions = async () => {
  await act(async () => { boutonReaction().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
};

it("montre l'envoi en cours et attend un ID serveur avant de proposer des actions", async () => {
  await vue.render(<Message message={{ ...message, id: "~transaction", eventId: undefined, senderId: "@moi:sion.test", sending: true }} showHeader={false} isFirst />);
  expect(bulle().getAttribute("aria-busy")).toBe("true");
  expect(vue.container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("chat.sending");
  expect(vue.container.querySelector('[aria-label="chat.reply"]')).toBeNull();
  await ouvrir();
  expect(menu()).toBeNull();
});

it("seuls Réagir et Répondre restent visibles et fonctionnent", async () => {
  serveur.pouvoir = 100;
  await rendre(true);
  expect(Array.from(vue.container.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"))).toEqual(["chat.react", "chat.reply"]);
  await vue.click('[aria-label="chat.reply"]');
  expect(useAppStore.getState().replyingTo?.eventId).toBe("$message");
  await ouvrirReactions();
  await act(async () => { selecteurReaction()!.querySelector("button")!.click(); });
  expect(serveur.reagir).toHaveBeenCalledWith("!salon", "$message", "😂");
});

it.each([
  { own: true, x: 580, expectedLeft: 280 },
  { own: false, x: 0, expectedLeft: 8 },
])("le sélecteur échappe au chat et reste visible près du bord (message propre : $own)", async ({ own, x, expectedLeft }) => {
  vi.stubGlobal("innerWidth", 620);
  vi.stubGlobal("innerHeight", 600);
  vue.container.style.cssText = "overflow: hidden; contain: strict; width: 620px; height: 600px";
  await rendre(own);
  vi.spyOn(boutonReaction().parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(x, 400, 20, 20));
  await ouvrirReactions();
  const picker = selecteurReaction()!;
  expect(picker.parentElement).toBe(document.body);
  expect(vue.container.contains(picker)).toBe(false);
  expect(picker.style.position).toBe("fixed");
  expect(picker.style.left).toBe(`${expectedLeft}px`);
  expect(picker.style.top).toBe("36px");
  expect(picker.style.width).toBe("320px");
  expect(picker.style.height).toBe("360px");
});

it("le sélecteur tient dans une petite fenêtre même en bas du chat", async () => {
  vi.stubGlobal("innerWidth", 280);
  vi.stubGlobal("innerHeight", 300);
  await rendre(true);
  vi.spyOn(boutonReaction().parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(230, 264, 20, 20));
  await ouvrirReactions();
  const picker = selecteurReaction()!;
  expect(picker.style.left).toBe("8px");
  expect(picker.style.top).toBe("8px");
  expect(picker.style.width).toBe("264px");
  expect(picker.style.height).toBe("284px");
});

it("la recherche et le défilement des emojis restent accessibles ; les événements extérieurs ferment le sélecteur", async () => {
  await rendre(true);
  await ouvrirReactions();
  await act(async () => {
    selecteurReaction()!.querySelector("input")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    selecteurReaction()!.dispatchEvent(new Event("scroll"));
  });
  expect(selecteurReaction()).not.toBeNull();
  await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(selecteurReaction()).toBeNull();
  await ouvrirReactions();
  await act(async () => { vue.container.dispatchEvent(new Event("scroll")); });
  expect(selecteurReaction()).toBeNull();
  await ouvrirReactions();
  await act(async () => { window.dispatchEvent(new Event("resize")); });
  expect(selecteurReaction()).toBeNull();
});

it("Échap ferme le sélecteur et rend le focus au bouton de réaction", async () => {
  await rendre(true);
  await ouvrirReactions();
  await act(async () => { selecteurReaction()!.querySelector<HTMLInputElement>("input")!.focus(); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(selecteurReaction()).toBeNull();
  expect(document.activeElement).toBe(boutonReaction());
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

it("le droit d'épingler ne donne pas celui de supprimer quand le seuil redact est supérieur", async () => {
  serveur.pouvoir = 50; serveur.redact = 75;
  await rendre(); await ouvrir();
  expect(libelles()).toEqual(["chat.pinMessage", "report.action"]);
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

const image = (id: string): ChatMessage => ({
  ...message, id, eventId: id, text: "", time: "12:03",
  attachments: [{ id, name: `${id}.png`, mimeType: "image/png", size: 12, url: `https://media.invalid/${id}` }],
});

it("affiche la légende après l’image dans une seule bulle", async () => {
  await vue.render(<Message message={{ ...image("$photo"), text: "Pour avoir la bêta !" }} showHeader={false} isFirst />);
  expect(vue.container.querySelectorAll(".sion-message-bulle")).toHaveLength(1);
  const photo = bulle().querySelector('[role="button"]')!;
  const legende = bulle().querySelector(".sion-legende-media")!;
  expect(legende.textContent).toBe("Pour avoir la bêta !");
  expect(photo.compareDocumentPosition(legende) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("chaque image en mosaïque conserve sa réponse et ses réactions", async () => {
  const images = [image("$image1"), image("$image2")];
  await vue.render(<Message message={images[0]} showHeader isFirst><div className="sion-mosaique">
    {images.map((m) => <div key={m.id} data-event-id={m.eventId}><Message message={m} enMosaique showHeader={false} isFirst={false} /></div>)}
  </div></Message>);
  expect(vue.container.querySelectorAll(".sion-message-bulle")).toHaveLength(2);
  expect(vue.container.querySelectorAll('[aria-label="chat.reply"]')).toHaveLength(2);
  await vue.click('[data-event-id="$image2"] [aria-label="chat.reply"]');
  expect(useAppStore.getState().replyingTo?.eventId).toBe("$image2");
  await act(async () => { vue.container.querySelector('[data-event-id="$image1"] [aria-label="chat.react"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
  await act(async () => { selecteurReaction()!.querySelector("button")!.click(); });
  expect(serveur.reagir).toHaveBeenCalledExactlyOnceWith("!salon", "$image1", "😂");
});

it("le clavier ouvre l'original d'une vignette et la suppression cible seulement cette image", async () => {
  const m = { ...image("$image2"), senderId: "@moi:sion.test" };
  await vue.render(<Message message={m} enMosaique showHeader={false} isFirst={false} />);
  await act(async () => { vue.container.querySelector('[role="button"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(document.body.querySelector<HTMLImageElement>('img[src="https://media.invalid/$image2"]')).not.toBeNull();
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  await ouvrir();
  expect(libelles()).toEqual(["chat.reply", "chat.react", "chat.deleteMessage"]);
  await choisir("chat.deleteMessage"); await choisir("chat.deleteMessageConfirm");
  expect(serveur.supprimer).toHaveBeenCalledExactlyOnceWith("!salon", "$image2");
});

it("libère aussi une image déchiffrée après le démontage de sa mosaïque", async () => {
  let terminer!: (url: string) => void;
  serveur.dechiffrer.mockReturnValue(new Promise<string>((resolve) => { terminer = resolve; }));
  const revoquer = vi.fn(); const UrlOriginale = URL;
  vi.stubGlobal("URL", class extends UrlOriginale { static revokeObjectURL = revoquer; });
  const m = image("$chiffree");
  m.attachments![0].encryptedFile = { url: "mxc://hs/image", key: { alg: "A256CTR", key_ops: ["decrypt"], kty: "oct", k: "fictif", ext: true }, iv: "iv", hashes: {}, v: "v2" };
  await vue.render(<Message message={m} enMosaique showHeader={false} isFirst={false} />);
  await vue.render(<div />);
  await act(async () => { terminer("blob:image-dechiffree"); });
  expect(revoquer).toHaveBeenCalledExactlyOnceWith("blob:image-dechiffree");
});

it("le menu de l'image propose la sélection individuelle et celle du groupe, en gardant copier et enregistrer", async () => {
  const basculer = vi.fn(), ajouter = vi.fn();
  const m = image("$image1");
  await vue.render(<SelectionMessagesContext.Provider value={{ ids: new Set(), basculer, ajouter }}>
    <Message message={m} enMosaique groupeIds={["$image1", "$image2"]} showHeader={false} isFirst={false} />
  </SelectionMessagesContext.Provider>);
  await act(async () => { vue.container.querySelector('[role="button"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 200 })); });
  expect(libelles()).toContain("chat.copyImage"); expect(libelles()).toContain("chat.saveImage");
  await choisir("chat.selectMessage"); expect(basculer).toHaveBeenCalledExactlyOnceWith("$image1");
  await ouvrir(); await choisir("chat.selectImageGroup"); expect(ajouter).toHaveBeenCalledExactlyOnceWith(["$image1", "$image2"]);
});
