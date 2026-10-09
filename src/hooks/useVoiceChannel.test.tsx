import { act, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../test/interface";
import { useVoiceChannel } from "./useVoiceChannel";
import { useLiveKitStore } from "../stores/useLiveKitStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useAppStore } from "../stores/useAppStore";
import { useAuthStore } from "../stores/useAuthStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import type { ParticipantInfo } from "../types/livekit";
import type { connectNativeSession } from "../services/nativeVoiceSession";

const services = vi.hoisted(() => ({
  connect: vi.fn(), disconnect: vi.fn(), wait: vi.fn(),
  joinRoom: vi.fn(), rejoindreVoix: vi.fn(), quitterVoix: vi.fn(),
  status: vi.fn(),
}));

vi.mock("../services/nativeVoiceSession", () => ({
  connectNativeSession: services.connect,
  disconnectNativeSession: services.disconnect,
  waitForNativeSessionCleanup: services.wait,
}));
vi.mock("../services/moteur", () => ({ moteurRust: () => true }));
vi.mock("../services/matrixService", () => ({
  joinRoom: services.joinRoom,
  getMatrixClient: () => null,
  getLocalVoiceState: () => ({ muted: false, deafened: false }),
  sendCallMemberEvent: vi.fn(), removeCallMemberEvent: vi.fn(), republishCallMember: vi.fn(),
}));
vi.mock("../services/matrixCore", () => ({
  rejoindreVoix: services.rejoindreVoix, quitterVoix: services.quitterVoix,
}));
vi.mock("../services/androidVoiceService", () => ({
  autoriserMicro: async () => true, startVoiceService: vi.fn(), stopVoiceService: vi.fn(),
}));
vi.mock("../services/cursorService", () => ({ setNativeCursorDisplayName: vi.fn() }));
vi.mock("../services/cursorOverlayService", () => ({ closeCursorOverlay: async () => {} }));
vi.mock("../services/voiceChannelSounds", () => ({
  onParticipantJoined: vi.fn(), onParticipantLeft: vi.fn(), noteConnectionLost: vi.fn(),
  resetVoiceCues: vi.fn(), primeActionCues: vi.fn(), playPokeCue: vi.fn(),
}));
vi.mock("../services/voiceNativeService", () => ({
  isVoiceNativeAvailable: async () => true,
  getVoiceNativeStatus: services.status,
  overlayMatrixVoiceState: (participants: ParticipantInfo[]) => participants,
}));
vi.mock("../services/transcriptionService", () => ({
  syncArmedTranscribers: vi.fn(), rebroadcastTranscribeArm: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn() }));

const vue = montage();
const participant: ParticipantInfo = {
  identity: "@alice:test", name: "Alice", isSpeaking: false, isMuted: false,
  isScreenSharing: false, isDeafened: false, audioLevel: 0, connectionQuality: "excellent",
};
let rendus: number;
let commandes: ReturnType<typeof useVoiceChannel>;
let session: Parameters<typeof connectNativeSession>[0] | null;

function CommandesVocales() {
  const actions = useVoiceChannel();
  useEffect(() => {
    commandes = actions;
    rendus++;
  });
  return null;
}

function Participants() {
  const participants = useLiveKitStore((s) => s.participants);
  const connected = useLiveKitStore((s) => s.connected);
  return <output>{connected ? participants.map((p) => `${p.name}:${p.audioLevel}`).join(",") : "déconnecté"}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  rendus = 0;
  session = null;
  useLiveKitStore.getState().disconnect();
  useAppStore.setState({ connectedVoiceChannel: null, connectingVoiceChannel: null });
  useAuthStore.setState({ credentials: null });
  useSettingsStore.setState({ joinMuted: false });
  useMatrixStore.setState({ channels: [], messages: {}, currentUserId: "@moi:test" });
  services.rejoindreVoix.mockResolvedValue({ url: "wss://voice.test", jeton: "jeton-test", chiffre: false });
  services.quitterVoix.mockResolvedValue(undefined);
  services.status.mockResolvedValue(null);
  services.connect.mockImplementation(async (options: Parameters<typeof connectNativeSession>[0]) => {
    session = options;
    useLiveKitStore.getState().connect(options.room);
  });
  services.disconnect.mockImplementation(async () => {
    await session?.onClosed();
    session = null;
  });
});

afterEach(async () => {
  await session?.onClosed();
  vi.useRealTimers();
});

it("met à jour les participants sans redessiner le parent qui utilise les commandes vocales", async () => {
  await vue.render(<><CommandesVocales /><Participants /></>);
  const initial = rendus;
  const rejoindre = commandes.joinVoiceChannel;
  await act(async () => useLiveKitStore.getState().connect("!vocal:test"));
  for (let i = 1; i <= 8; i++) {
    await act(async () => useLiveKitStore.getState().setParticipants([{ ...participant, audioLevel: i / 10 }]));
  }
  expect(vue.container.textContent).toBe("Alice:0.8");
  expect(commandes.joinVoiceChannel).toBe(rejoindre);
  expect(rendus).toBe(initial);
});

it("ne redessine pas les commandes vocales quand Matrix reçoit des messages ou actualise les salons", async () => {
  await vue.render(<CommandesVocales />);
  const initial = rendus;
  for (let i = 0; i < 8; i++) {
    await act(async () => useMatrixStore.setState({ channels: [], messages: { "!texte:test": [] } }));
  }
  expect(rendus).toBe(initial);
});

it("conserve la connexion, les événements de participants et le raccrochage natifs", async () => {
  await vue.render(<><CommandesVocales /><Participants /></>);
  await act(async () => commandes.joinVoiceChannel("!vocal:test"));
  expect(services.joinRoom).toHaveBeenCalledWith("!vocal:test");
  expect(services.connect).toHaveBeenCalledWith(expect.objectContaining({
    url: "wss://voice.test", token: "jeton-test", room: "!vocal:test", displayName: "@moi:test",
  }));
  expect(useAppStore.getState().connectedVoiceChannel).toBe("!vocal:test");

  await act(async () => {
    session!.onParticipants([participant], () => true);
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(vue.container.textContent).toBe("Alice:0");

  await act(async () => commandes.leaveVoiceChannel("!vocal:test"));
  expect(services.quitterVoix).toHaveBeenCalledOnce();
  expect(services.disconnect).toHaveBeenCalled();
  expect(useAppStore.getState().connectedVoiceChannel).toBeNull();
  expect(vue.container.textContent).toBe("déconnecté");
});

it("n'installe plus de heartbeat si la session ferme pendant la lecture tardive de son état", async () => {
  let terminer!: (value: null) => void;
  services.status.mockImplementationOnce(() => new Promise((resolve) => { terminer = resolve; }));
  await vue.render(<CommandesVocales />);
  let connexion!: Promise<void>;
  await act(async () => { connexion = commandes.joinVoiceChannel("!vocal:test"); });
  await vi.waitFor(() => expect(services.status).toHaveBeenCalledOnce());
  await act(async () => { await session!.onClosed(); terminer(null); await connexion; });
  expect(vi.getTimerCount()).toBe(0);
});
