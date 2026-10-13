import { act, useEffect } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { NavigationMobile } from "./NavigationMobile";
import { useRetourMobile } from "../../hooks/useRetourMobile";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import type { Channel } from "../../types/matrix";

const contexte = vi.hoisted(() => ({ montages: 0, quitter: vi.fn().mockResolvedValue(undefined), unregister: vi.fn(), invoke: vi.fn() }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => true }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => null }));
vi.mock("../../services/matrixService", () => ({ getMatrixClient: () => null, leaveRoom: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ onBackButtonPress: vi.fn(async () => ({ unregister: contexte.unregister })) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: contexte.invoke }));
vi.mock("../layout/MainArea", () => ({ MainArea: function Chat() {
  useEffect(() => { contexte.montages++; }, []);
  return <input data-brouillon defaultValue="Brouillon conservé" />;
} }));
vi.mock("./MobileVoiceBar", () => ({ MOBILE_VOICE_BAR_HEIGHT: 120 }));
vi.mock("../sidebar/AccountPopover", () => ({ AccountPopover: () => null }));
vi.mock("../sidebar/VerificationBanner", () => ({ VerificationBanner: () => null }));
vi.mock("../sidebar/ChannelItem", () => ({ ChannelItem: ({ channel }: { channel: Channel }) =>
  <button data-room={channel.id} onClick={() => useAppStore.getState().setActiveChannel(channel.id, channel.hasVoice)}>{channel.name}</button> }));
const vue = montage();
const salon = (id: string, props = {}): Channel => ({ id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...props });
function Interface() { useRetourMobile(true, contexte.quitter); return <NavigationMobile />; }

beforeEach(() => {
  contexte.montages = 0; contexte.quitter.mockClear(); contexte.invoke.mockClear(); contexte.unregister.mockClear();
  useAppStore.setState({ mobileView: "sidebar", activeChannel: "!texte", connectedVoiceChannel: "!vocal", connectingVoiceChannel: null,
    showSettings: false, showAdmin: false, showAccountPanel: false, userContextMenu: null, lastReadMessageId: {} });
  useLayoutStore.setState({ panneau: null, panneaux: [] });
  useEspacesStore.setState({ espaceActif: "!espace", fenetre: null, derniersSalons: {} });
  useSettingsStore.setState({ sidebarView: "channels" });
  useMatrixStore.setState({ channels: [salon("!espace", { isSpace: true, spaceChildren: ["!texte", "!vocal"] }),
    salon("!texte"), salon("!vocal", { hasVoice: true }), salon("!libre"), salon("!mp", { isDM: true })], messages: {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 800));
});
const pointer = async (type: string, x: number, y = 140, cible?: Element) => {
  const element = vue.container.querySelector<HTMLElement>(".sion-mobile-navigation")!;
  Object.assign(element, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  await act(async () => { (cible ?? element).dispatchEvent(event); });
};
const retour = async (phase: "start" | "progress" | "cancel" | "commit", touchX?: number) => {
  await act(async () => { window.__SION_MOBILE_BACK__?.({ phase, touchX }); });
};

it("garde le même chat et son brouillon pendant les trois vues, sans quitter le vocal", async () => {
  await vue.render(<Interface />);
  const brouillon = vue.container.querySelector<HTMLInputElement>("[data-brouillon]")!;
  await vue.click('[data-room="!vocal"]');
  expect(useAppStore.getState().mobileView).toBe("chat");
  await retour("commit");
  expect(useAppStore.getState().mobileView).toBe("channels");
  await retour("commit");
  expect(useAppStore.getState().mobileView).toBe("sidebar");
  expect(vue.container.querySelector("[data-brouillon]")).toBe(brouillon);
  expect(brouillon.value).toBe("Brouillon conservé");
  expect(contexte.montages).toBe(1);
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
  expect(contexte.quitter).not.toHaveBeenCalled();
});

it("un geste court révèle les salons, un geste long les espaces et l'annulation garde le chat", async () => {
  useAppStore.setState({ mobileView: "chat" });
  await vue.render(<Interface />);
  await pointer("pointerdown", 8); await pointer("pointermove", 140); await pointer("pointerup", 140);
  expect(useAppStore.getState().mobileView).toBe("channels");
  await act(async () => useAppStore.getState().setMobileView("chat"));
  await pointer("pointerdown", 8); await pointer("pointermove", 360); await pointer("pointerup", 360);
  expect(useAppStore.getState().mobileView).toBe("sidebar");
  await act(async () => useAppStore.getState().setMobileView("chat"));
  await pointer("pointerdown", 8); await pointer("pointermove", 200); await pointer("pointercancel", 200);
  expect(useAppStore.getState().mobileView).toBe("chat");
});

it("la fermeture dans l'autre sens retrouve le chat sans changer de salon", async () => {
  await vue.render(<Interface />);
  await pointer("pointerdown", 300); await pointer("pointermove", 220); await pointer("pointerup", 220);
  expect(useAppStore.getState().mobileView).toBe("channels");
  await pointer("pointerdown", 260); await pointer("pointermove", 110); await pointer("pointerup", 110);
  expect(useAppStore.getState().mobileView).toBe("chat");
  expect(useAppStore.getState().activeChannel).toBe("!texte");
});

it("le transfert de capture tactile depuis un enfant n'annule pas le geste", async () => {
  useAppStore.setState({ mobileView: "chat" });
  await vue.render(<Interface />);
  const enfant = vue.container.querySelector(".sion-mobile-chat")!;
  await pointer("pointerdown", 8, 140, enfant);
  await pointer("pointermove", 140);
  await pointer("lostpointercapture", 140, 140, enfant);
  await pointer("pointerup", 140);
  expect(useAppStore.getState().mobileView).toBe("channels");
});

it("la progression native reste temporaire et respecte un geste annulé ou raccourci", async () => {
  useAppStore.setState({ mobileView: "chat" });
  await vue.render(<Interface />);
  await retour("start", 0); await retour("progress", 150);
  expect(useAppStore.getState().mobileView).toBe("chat");
  expect(vue.container.querySelector<HTMLElement>(".sion-mobile-chat")!.style.transform).toBe("translate3d(150px, 0, 0)");
  await retour("cancel");
  expect(useAppStore.getState().mobileView).toBe("chat");
  await retour("start", 0); await retour("progress", 360); await retour("progress", 100); await retour("commit");
  expect(useAppStore.getState().mobileView).toBe("channels");
  await act(async () => useAppStore.getState().setMobileView("chat"));
  await retour("start", 0); await retour("progress", 360); await retour("commit");
  expect(useAppStore.getState().mobileView).toBe("sidebar");
});

it("la saisie et le défilement vertical ne déclenchent pas la navigation", async () => {
  useAppStore.setState({ mobileView: "chat" });
  await vue.render(<Interface />);
  await pointer("pointerdown", 8); await pointer("pointermove", 14, 260); await pointer("pointerup", 14, 260);
  expect(useAppStore.getState().mobileView).toBe("chat");
  await pointer("pointerdown", 8, 140, vue.container.querySelector("input")!);
  await pointer("pointermove", 300); await pointer("pointerup", 300);
  expect(useAppStore.getState().mobileView).toBe("chat");
});

it("le clic généré par un glissement n'entre pas dans un autre salon", async () => {
  await vue.render(<Interface />);
  await pointer("pointerdown", 300); await pointer("pointermove", 230); await pointer("pointerup", 230);
  await vue.click('[data-room="!vocal"]');
  expect(useAppStore.getState().activeChannel).toBe("!texte");
});

it("changer d'espace, afficher les MP ou les salons hors espace laisse le menu visible", async () => {
  await vue.render(<Interface />);
  await vue.click('[data-space-id="!espace"]');
  expect(useAppStore.getState().mobileView).toBe("sidebar");
  await vue.click('[data-espace="dm"]');
  expect(useAppStore.getState().mobileView).toBe("sidebar");
  await vue.click('[data-salons-hors-espace]');
  expect(useAppStore.getState().mobileView).toBe("sidebar");
  expect(useEspacesStore.getState().espaceActif).toBeNull();
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
});

it("Retour ferme d'abord les fenêtres et feuilles ouvertes", async () => {
  useAppStore.setState({ mobileView: "chat", connectedVoiceChannel: "!vocal" });
  await vue.render(<Interface />);
  await act(async () => useEspacesStore.getState().ouvrir("gerer"));
  await retour("start", 0); await retour("progress", 360); await retour("commit");
  expect(useEspacesStore.getState().fenetre).toBeNull();
  expect(useAppStore.getState().mobileView).toBe("chat");
  await act(async () => useLayoutStore.getState().ouvrirPanneau("soundboard"));
  await retour("commit");
  expect(useLayoutStore.getState().panneau).toBeNull();
  expect(useAppStore.getState().mobileView).toBe("chat");
});

it("une board masquée hors vocal ne bloque pas le retour vers les salons", async () => {
  useAppStore.setState({ mobileView: "chat", connectedVoiceChannel: null });
  useLayoutStore.getState().ouvrirPanneau("soundboard");
  await vue.render(<Interface />);
  expect(document.querySelector(".sion-mobile-panel-sheet")).toBeNull();
  await retour("start", 0); await retour("progress", 160); await retour("commit");
  expect(useAppStore.getState().mobileView).toBe("channels");
  expect(useLayoutStore.getState().panneaux).toEqual(["soundboard"]);
});

it("Retour ferme le menu d'un espace avant de naviguer", async () => {
  await vue.render(<Interface />);
  const bouton = vue.container.querySelector('[data-space-id="!espace"]')!;
  await act(async () => bouton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 100 })));
  expect(document.querySelector('[data-menu-contextuel]')).not.toBeNull();
  await retour("start", 0); await retour("progress", 360); await retour("commit");
  expect(document.querySelector('[data-menu-contextuel]')).toBeNull();
  expect(useAppStore.getState().mobileView).toBe("sidebar");
  expect(contexte.quitter).not.toHaveBeenCalled();
});

it("seule la confirmation de sortie depuis l'accueil quitte le vocal", async () => {
  await vue.render(<Interface />);
  await retour("commit");
  expect(contexte.quitter).not.toHaveBeenCalled();
  await retour("commit");
  expect(contexte.quitter).toHaveBeenCalledExactlyOnceWith("!vocal");
  expect(contexte.invoke).toHaveBeenCalledWith("exit_app");
});

it("retire le pont et l'écouteur Retour quand l'interface est démontée", async () => {
  await vue.render(<Interface />);
  expect(window.__SION_MOBILE_BACK__).toBeTypeOf("function");
  await vue.render(<div />);
  expect(window.__SION_MOBILE_BACK__).toBeUndefined();
  expect(contexte.unregister).toHaveBeenCalledOnce();
});
