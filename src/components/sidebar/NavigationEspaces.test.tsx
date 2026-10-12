import { useEspacesStore } from "../../stores/useEspacesStore";
import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { NavigationEspaces } from "./NavigationEspaces";
import { ChannelList } from "./ChannelList";
import { useAppStore, APP_SESSION_START_TS } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import type { Channel, ChatMessage } from "../../types/matrix";

const contexte = vi.hoisted(() => ({ mobile: false, partager: vi.fn().mockResolvedValue("copie") }));
vi.mock("../../services/partageInvitation", () => ({ partagerInvitation: contexte.partager }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options?: { count?: number }) => key === "chat.unreadCount" ? `${options?.count} non lus` : key,
}) }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => contexte.mobile }));
vi.mock("../../services/adminCommandService", () => ({ findAdminRoom: () => "!admin" }));
vi.mock("../../services/matrixService", () => ({ getMatrixClient: () => null, leaveRoom: vi.fn() }));
vi.mock("./ChannelItem", () => ({ ChannelItem: ({ channel }: { channel: Channel }) => <div data-room={channel.id}>{channel.name}</div> }));
vi.mock("./MatrixRain", () => ({ MatrixRain: () => null }));

const vue = montage();
const salon = (id: string, isDM = false): Channel => ({
  id, name: id, isDM, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0,
});
const salons = [salon("!general"), salon("!jeux"), salon("!alice", true), salon("!bob", true), salon("!admin")];
const message = (id: number, senderId = "@alice:sion", ts = APP_SESSION_START_TS + 100): ChatMessage => ({
  id, senderId, user: "Alice", role: "user", time: "", text: "Test", ts,
});
beforeEach(() => {
  contexte.mobile = false;
  contexte.partager.mockClear();
  useEspacesStore.setState({ espaceActif: null, fenetre: null, derniersSalons: {} });
  useSettingsStore.setState({ sidebarView: "channels", channelSort: "name" });
  useLayoutStore.setState({ sidebarMode: "rail" });
  useAppStore.setState({ activeChannel: "!general", connectedVoiceChannel: "!vocal", connectingVoiceChannel: null, lastReadMessageId: {} });
  useMatrixStore.setState({ channels: salons, messages: {}, currentUserId: "@moi:sion" });
});

it("le rail change la liste et retrouve le dernier salon ou MP sans agir sur le vocal", async () => {
  await vue.render(<><NavigationEspaces rail /><ChannelList compact /></>);
  expect(vue.container.querySelector('[data-room="!general"]')).not.toBeNull();
  expect(vue.container.querySelector('[data-room="!alice"]')).toBeNull();
  await vue.click('[data-espace="dm"]');
  expect(useSettingsStore.getState().sidebarView).toBe("dm");
  expect(vue.container.querySelector('[data-room="!general"]')).toBeNull();
  expect(vue.container.querySelector('[data-room="!alice"]')).not.toBeNull();
  await act(async () => useAppStore.getState().setActiveChannel("!alice", false));
  await vue.click('[data-salons-hors-espace]');
  expect(useAppStore.getState().activeChannel).toBe("!general");
  await act(async () => useAppStore.getState().setActiveChannel("!jeux", false));
  await vue.click('[data-espace="dm"]');
  expect(useAppStore.getState().activeChannel).toBe("!alice");
  await vue.click('[data-salons-hors-espace]');
  expect(useAppStore.getState().activeChannel).toBe("!jeux");
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
});

it("le compteur ignore ses propres messages, l'historique, le salon ouvert et l'administration", async () => {
  useMatrixStore.setState({ messages: {
    "!general": [message(1)], "!admin": [message(2)],
    "!alice": [message(5, "@alice:sion", APP_SESSION_START_TS - 10), message(3), message(4, "@moi:sion")],
    "!jeux": [message(6)],
  } });
  await vue.render(<><NavigationEspaces rail /><ChannelList /></>);
  for (const selecteur of ['[data-salons-hors-espace]', '[data-espace="dm"]']) {
    const bouton = vue.container.querySelector(selecteur)!;
    expect(bouton.querySelector(".sion-rail-compteur, .sion-salons-hors-espace-compteur")?.textContent).toBe("1");
    expect(bouton.getAttribute("aria-label")).toContain("1 non lus");
  }
  await act(async () => useAppStore.setState({ lastReadMessageId: { "!alice": "3", "!jeux": "6" } }));
  expect(vue.container.querySelector(".sion-rail-compteur, .sion-salons-hors-espace-compteur")).toBeNull();
});

it("un espace sélectionné rouvre la liste masquée", async () => {
  useLayoutStore.setState({ sidebarMode: "hidden" });
  await vue.render(<NavigationEspaces rail />);
  await vue.click('[data-espace="dm"]');
  expect(useLayoutStore.getState().sidebarMode).toBe("rail");
  expect(vue.container.querySelector('[data-espace="dm"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("ne restaure pas une conversation quittée", async () => {
  await vue.render(<><NavigationEspaces rail /><ChannelList compact /></>);
  await act(async () => useAppStore.getState().setActiveChannel("!alice", false));
  await vue.click('[data-salons-hors-espace]');
  await act(async () => useMatrixStore.setState({ channels: salons.filter(s => s.id !== "!alice") }));
  await vue.click('[data-espace="dm"]');
  expect(useAppStore.getState().activeChannel).toBe("!general");
});

it("le menu desktop déployé n'a pas de second sélecteur Serveur / MP", async () => {
  await vue.render(<ChannelList />);
  expect(vue.container.querySelector('[data-espace]')).toBeNull();
});

it("le téléphone conserve les MP sans ouvrir une conversation en les sélectionnant", async () => {
  contexte.mobile = true;
  await vue.render(<ChannelList />);
  await vue.click('[data-espace="dm"]');
  expect(useSettingsStore.getState().sidebarView).toBe("dm");
  expect(useAppStore.getState().activeChannel).toBe("!general");
  expect(vue.container.querySelector('[data-room="!alice"]')).not.toBeNull();
});

it("l'accès aux salons hors espace disparaît quand seuls des salons rattachés, privés ou techniques restent", async () => {
  useMatrixStore.setState({ channels: [
    ...salons.filter((c) => c.id !== "!admin"),
    { ...salon("!espace"), isSpace: true, spaceChildren: ["!general", "!jeux"] },
    { ...salon("!board"), isSoundboard: true },
    { ...salon("!invite"), membership: "invite" },
  ] });
  await vue.render(<><NavigationEspaces rail /><ChannelList compact /></>);
  expect(vue.container.querySelector('[data-espace="channels"]')).toBeNull();
  expect(vue.container.querySelector('[data-salons-hors-espace]')).toBeNull();
  await act(async () => useMatrixStore.setState((s) => ({ channels: [...s.channels, salon("!libre")] })));
  expect(vue.container.querySelector('[data-salons-hors-espace]')).not.toBeNull();
  await vue.click('[data-space-id="!espace"]');
  await vue.click('[data-salons-hors-espace]');
  expect(useAppStore.getState().activeChannel).toBe("!libre");
  expect(vue.container.querySelector('[data-room="!libre"]')).not.toBeNull();
  expect(vue.container.querySelector('[data-room="!general"]')).toBeNull();
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
});

it("retrouve le dernier salon de l'espace après un passage par les MP", async () => {
  useMatrixStore.setState({ channels: [...salons,
    { ...salon("!espace"), isSpace: true, spaceChildren: ["!general", "!jeux"] },
  ] });
  await vue.render(<><NavigationEspaces rail /><ChannelList /></>);
  await vue.click('[data-space-id="!espace"]');
  await act(async () => useAppStore.getState().setActiveChannel("!jeux", false));
  await vue.click('[data-espace="dm"]');
  await act(async () => useAppStore.getState().setActiveChannel("!alice", false));
  await vue.click('[data-space-id="!espace"]');
  expect(useAppStore.getState().activeChannel).toBe("!jeux");
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
});

it("affiche les Espaces avec leur logo et isole les salons sans couper le vocal", async () => {
  useMatrixStore.setState({ channels: [...salons,
    { ...salon("!A"), name: "Equipe A", isSpace: true, spaceChildren: ["!general"], icon: "https://example.test/a.png" },
    { ...salon("!B"), name: "Equipe B", isSpace: true, spaceChildren: ["!jeux"] },
  ] });
  await vue.render(<><NavigationEspaces rail /><ChannelList compact /></>);
  await vue.click('[data-space-id="!A"]');
  expect(vue.container.querySelector('[data-space-id="!A"] img')?.getAttribute("src")).toBe("https://example.test/a.png");
  expect(vue.container.querySelector('[data-room="!general"]')).not.toBeNull();
  expect(vue.container.querySelector('[data-room="!jeux"]')).toBeNull();
  await vue.click('[data-space-id="!B"]');
  expect(vue.container.querySelector('[data-room="!general"]')).toBeNull();
  expect(vue.container.querySelector('[data-room="!jeux"]')).not.toBeNull();
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
  expect(useAppStore.getState().activeChannel).toBe("!jeux");
  await vue.click('[data-espace="dm"]');
  expect(vue.container.querySelector('[data-room="!alice"]')).not.toBeNull();
});
it("le bouton plus ouvre la création et la jointure d'Espaces", async () => {
  await vue.render(<NavigationEspaces rail />);
  await vue.click('[aria-label="spaces.add"]');
  expect(useEspacesStore.getState().fenetre).toBe("ajouter");
});

async function clicDroitEspace() {
  useMatrixStore.setState({ channels: [...salons, { ...salon("!espace"), name: "Équipe", isSpace: true, spaceChildren: ["!jeux"] }] });
  await vue.render(<NavigationEspaces rail />);
  await act(async () => vue.container.querySelector('[data-space-id="!espace"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 40 })));
}

it("le clic droit affiche partager et gérer sans changer la conversation ou l'espace", async () => {
  await clicDroitEspace();
  expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map(b => b.textContent)).toEqual(["spaces.shareInvitation", "spaces.manageSpace"]);
  expect(useEspacesStore.getState().fenetre).toBeNull();
  expect(useEspacesStore.getState().espaceActif).toBeNull();
  expect(useAppStore.getState().activeChannel).toBe("!general");
  await act(async () => (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
  expect(contexte.partager).toHaveBeenCalledWith("!espace", "spaces.shareInvitationTitle", false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toBe("spaces.copied");
  expect(useEspacesStore.getState().fenetre).toBeNull();
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
});

it("gérer l'espace ouvre la bonne équipe seulement après le choix dans le menu", async () => {
  await clicDroitEspace();
  await act(async () => (document.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click());
  expect(useEspacesStore.getState().espaceActif).toBe("!espace");
  expect(useEspacesStore.getState().fenetre).toBe("gerer");
});

it("l'appui long affiche le menu et ne sélectionne pas l'espace au relâcher", async () => {
  contexte.mobile = true;
  useMatrixStore.setState({ channels: [...salons, { ...salon("!espace"), isSpace: true, spaceChildren: ["!jeux"] }] });
  await vue.render(<NavigationEspaces rail mobile />);
  vi.useFakeTimers();
  const bouton = vue.container.querySelector('[data-space-id="!espace"]')!;
  const toucher = (type: string, touches: { clientX: number; clientY: number }[]) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: touches });
    bouton.dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => { toucher("touchstart", [{ clientX: 30, clientY: 100 }]); vi.advanceTimersByTime(500); });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => { expect(toucher("touchend", []).defaultPrevented).toBe(true); (bouton as HTMLButtonElement).click(); });
    expect(useEspacesStore.getState().espaceActif).toBeNull();
    expect(useEspacesStore.getState().fenetre).toBeNull();
    await act(async () => (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
    expect(contexte.partager).toHaveBeenCalledWith("!espace", "spaces.shareInvitationTitle", true);
  } finally { vi.useRealTimers(); }
});
