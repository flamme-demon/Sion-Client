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

const contexte = vi.hoisted(() => ({ mobile: false }));
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
  await vue.click('[data-espace="channels"]');
  expect(useAppStore.getState().activeChannel).toBe("!general");
  await act(async () => useAppStore.getState().setActiveChannel("!jeux", false));
  await vue.click('[data-espace="dm"]');
  expect(useAppStore.getState().activeChannel).toBe("!alice");
  await vue.click('[data-espace="channels"]');
  expect(useAppStore.getState().activeChannel).toBe("!jeux");
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal");
});

it("le compteur ignore ses propres messages, l'historique, le salon ouvert et l'administration", async () => {
  useMatrixStore.setState({ messages: {
    "!general": [message(1)], "!admin": [message(2)],
    "!alice": [message(5, "@alice:sion", APP_SESSION_START_TS - 10), message(3), message(4, "@moi:sion")],
    "!jeux": [message(6)],
  } });
  await vue.render(<NavigationEspaces rail />);
  for (const espace of ["channels", "dm"]) {
    const bouton = vue.container.querySelector(`[data-espace="${espace}"]`)!;
    expect(bouton.querySelector(".sion-rail-compteur")?.textContent).toBe("1");
    expect(bouton.getAttribute("aria-label")).toContain("1 non lus");
  }
  await act(async () => useAppStore.setState({ lastReadMessageId: { "!alice": "3", "!jeux": "6" } }));
  expect(vue.container.querySelector(".sion-rail-compteur")).toBeNull();
});

it("un espace sélectionné rouvre la liste masquée", async () => {
  useLayoutStore.setState({ sidebarMode: "hidden" });
  await vue.render(<NavigationEspaces rail />);
  await vue.click('[data-espace="dm"]');
  expect(useLayoutStore.getState().sidebarMode).toBe("rail");
  expect(vue.container.querySelector('[data-espace="dm"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("ne restaure pas une conversation quittée", async () => {
  await vue.render(<NavigationEspaces rail />);
  await act(async () => useAppStore.getState().setActiveChannel("!alice", false));
  await vue.click('[data-espace="channels"]');
  await act(async () => useMatrixStore.setState({ channels: salons.filter(s => s.id !== "!alice") }));
  await vue.click('[data-espace="dm"]');
  expect(useAppStore.getState().activeChannel).toBe("!general");
});

it("le menu desktop déployé n'a pas de second sélecteur Serveur / MP", async () => {
  await vue.render(<ChannelList />);
  expect(vue.container.querySelector('[data-espace]')).toBeNull();
});

it("le téléphone conserve les deux onglets sans ouvrir une conversation en les sélectionnant", async () => {
  contexte.mobile = true;
  await vue.render(<ChannelList />);
  await vue.click('[data-espace="dm"]');
  expect(useSettingsStore.getState().sidebarView).toBe("dm");
  expect(useAppStore.getState().activeChannel).toBe("!general");
  expect(vue.container.querySelector('[data-room="!alice"]')).not.toBeNull();
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
