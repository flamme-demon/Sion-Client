import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";

const mock = vi.hoisted(() => ({ member: vi.fn(), invoke: vi.fn(), listeners: new Set<(event: { payload: { open: boolean; sender?: string | null; sources?: string[] } }) => void>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (_name: string, callback: (event: { payload: { open: boolean; sender?: string | null; sources?: string[] } }) => void) => {
  mock.listeners.add(callback);
  return Promise.resolve(() => mock.listeners.delete(callback));
} }));
vi.mock("../../services/matrixService", () => ({
  getMatrixClient: () => null,
  getRoomMemberInfo: mock.member,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./CameraStream", () => ({ CameraStream: ({ streamKey, label }: { streamKey: string; label: string }) => <canvas data-stream-key={streamKey} aria-label={label} /> }));
vi.mock("./ScreenShareView", () => ({ MeetingScreenTile: ({ identity, name }: { identity: string; name: string }) => <canvas data-stream-key={identity} aria-label={name} /> }));

import { VideoMeeting } from "./VideoMeeting";
import { useVideoMeetingStore } from "../../hooks/useVideoMeeting";
import { CameraStrip } from "./CameraStrip";
import { useCameraStore } from "../../services/cameraService";
import { useLiveKitStore } from "../../stores/useLiveKitStore";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import type { ParticipantInfo } from "../../types/livekit";

const vue = montage();
const identity = "@alice:example.org:PC";
const participant: ParticipantInfo = {
  identity, name: identity, isCameraEnabled: true,
  isSpeaking: false, isMuted: false, isDeafened: false,
  isScreenSharing: false, audioLevel: 0, connectionQuality: "unknown",
};

beforeEach(() => {
  delete window.__TAURI_INTERNALS__;
  mock.invoke.mockReset();
  useVideoMeetingStore.setState({ mode: "closed", selection: null, focus: null });
  mock.invoke.mockImplementation((command: string, args?: { sender?: string; streams?: { sender: string }[]; focus?: string }) => {
    if (command === "pip_native_open_streams") for (const callback of mock.listeners) callback({ payload: { open: true, sender: args?.focus || args?.streams?.[0]?.sender, sources: args?.streams?.map((s) => s.sender) } });
    if (command === "pip_native_close") for (const callback of mock.listeners) callback({ payload: { open: false, sender: null, sources: [] } });
    return Promise.resolve(command === "pip_native_sources" ? [] : null);
  });
  mock.member.mockReset();
  mock.member.mockImplementation((_room: string, userId: string) => ({ displayName: userId, avatarUrl: null }));
  useCameraStore.setState({ published: false, identity: "@local:example.org:PC" });
  useAppStore.setState({ connectedVoiceChannel: "!vocal:example.org", activeChannel: "!texte:example.org" });
  useMatrixStore.setState({ pinnedVersion: 0 });
  useLiveKitStore.setState({ participants: [participant] });
});

it("actualise la vignette et la vue agrandie quand le pseudo Matrix arrive après la webcam", async () => {
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  expect(document.querySelector(".sion-camera-tile > span")?.textContent).toBe("alice");
  await vue.click(".sion-camera-enlarge");
  expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("alice");

  mock.member.mockReturnValue({ displayName: "Alice du vocal", avatarUrl: null });
  await act(async () => useMatrixStore.setState({ pinnedVersion: 1 }));
  expect(mock.member).toHaveBeenCalledWith("!vocal:example.org", "@alice:example.org");
  expect(document.querySelector(".sion-camera-tile > span")?.textContent).toBe("Alice du vocal");
  expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Alice du vocal");
  expect(Array.from(document.querySelectorAll("canvas")).every((canvas) => canvas.dataset.streamKey === `camera:${identity}`)).toBe(true);
});

it("conserve un nom d'affichage LiveKit et écarte les webcams désactivées", async () => {
  useLiveKitStore.setState({ participants: [
    { ...participant, name: "  Alice  " },
    { ...participant, identity: "@bob:example.org:TEL", isCameraEnabled: false },
  ] });
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  expect(document.querySelectorAll(".sion-camera-tile")).toHaveLength(1);
  expect(document.querySelector(".sion-camera-tile > span")?.textContent).toBe("Alice");
  expect(mock.member).not.toHaveBeenCalled();
});

it("détache la webcam dans Sion puis dans le système et suit la fermeture native", async () => {
  window.__TAURI_INTERNALS__ = {};
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  await vue.click('[aria-label="camera.floatPip"]');
  expect(document.querySelector(".sion-camera-floating")).not.toBeNull();
  expect(document.querySelector(".sion-camera-tile canvas")).toBeNull();
  expect(document.querySelector(".sion-camera-floating canvas")?.getAttribute("data-stream-key")).toBe(`camera:${identity}`);
  const resize = document.querySelector<HTMLButtonElement>(".sion-camera-floating-resize")!;
  const before = Number.parseFloat(document.querySelector<HTMLElement>(".sion-camera-floating")!.style.width);
  await act(async () => resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(Number.parseFloat(document.querySelector<HTMLElement>(".sion-camera-floating")!.style.width)).toBe(before - 10);
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-camera-floating [aria-label="camera.systemPip"]')!.click());
  expect(mock.invoke).toHaveBeenCalledWith("pip_native_open_streams", { streams: [{ sender: `camera:${identity}`, name: "alice" }], focus: null });
  expect(document.querySelector(".sion-camera-floating")).toBeNull();
  expect(document.querySelector(".sion-camera-tile canvas")).toBeNull();
  await act(async () => { for (const callback of mock.listeners) callback({ payload: { open: false, sender: null } }); });
  expect(document.querySelector(".sion-camera-tile canvas")).not.toBeNull();
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_set_enabled")).toBe(false);
});

it("un PiP de partage ne masque pas la webcam et un refus du système conserve la carte", async () => {
  window.__TAURI_INTERNALS__ = {};
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  await act(async () => { for (const callback of mock.listeners) callback({ payload: { open: true, sender: identity } }); });
  expect(document.querySelector(".sion-camera-tile canvas")).not.toBeNull();
  await vue.click('[aria-label="camera.floatPip"]');
  mock.invoke.mockRejectedValueOnce(new Error("Fenêtre indisponible"));
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-camera-floating [aria-label="camera.systemPip"]')!.click());
  expect(document.querySelector(".sion-camera-floating")).not.toBeNull();
  expect(document.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-camera-floating [aria-label="camera.dockBack"]')!.click());
  expect(document.querySelector(".sion-camera-floating")).toBeNull();
  expect(document.querySelector(".sion-camera-tile canvas")).not.toBeNull();
});

it("réunit webcams et partage dans une seule fenêtre et permet de garder un seul flux", async () => {
  useLiveKitStore.setState({ participants: [
    { ...participant, isScreenSharing: true },
    { ...participant, identity: "@bob:example.org:PC", name: "Bob" },
  ] });
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  await vue.click('[aria-label="camera.floatPip"]');
  expect(document.querySelectorAll(".sion-camera-floating")).toHaveLength(1);
  expect(document.querySelectorAll(".sion-camera-floating canvas")).toHaveLength(3);
  expect(document.querySelector(".sion-meeting-main canvas")?.getAttribute("data-stream-key")).toBe(identity);
  expect(document.querySelectorAll(".sion-camera-strip canvas")).toHaveLength(0);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="meeting.choose"]')!.click());
  const labels = Array.from(document.querySelectorAll(".sion-meeting-picker label"));
  const screenLabel = labels.find((l) => l.textContent?.includes("meeting.screen"))!;
  await act(async () => screenLabel.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelectorAll(".sion-camera-floating canvas")).toHaveLength(1);
  expect(document.querySelectorAll(".sion-camera-strip canvas")).toHaveLength(2);
  expect(useVideoMeetingStore.getState().selection).toEqual([identity]);
  await act(async () => useLiveKitStore.setState({ participants: [participant] }));
  expect(document.querySelector(".sion-camera-floating")).toBeNull();
  expect(document.querySelector(".sion-camera-strip canvas")).not.toBeNull();
});

it("suit les nouvelles webcams en mode tous les flux sans les imposer à une sélection", async () => {
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  await vue.click('[aria-label="camera.floatPip"]');
  const bob = { ...participant, identity: "@bob:example.org:PC", name: "Bob" };
  await act(async () => useLiveKitStore.setState({ participants: [participant, bob] }));
  expect(document.querySelectorAll(".sion-camera-floating canvas")).toHaveLength(2);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="meeting.choose"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".sion-meeting-picker label:nth-child(2) button")!.click());
  await act(async () => useLiveKitStore.setState({ participants: [participant, bob, { ...participant, identity: "@chloe:example.org:PC", name: "Chloé" }] }));
  expect(document.querySelectorAll(".sion-camera-floating canvas")).toHaveLength(1);
  expect(document.querySelectorAll(".sion-camera-strip canvas")).toHaveLength(2);
  await act(async () => document.querySelector<HTMLInputElement>(".sion-meeting-picker input")!.click());
  expect(document.querySelectorAll(".sion-camera-floating canvas")).toHaveLength(3);
  await act(async () => useAppStore.setState({ connectedVoiceChannel: null }));
  expect(document.querySelector(".sion-camera-floating")).toBeNull();
});

it("transfère la sélection entière au système et remet tous les flux au retour", async () => {
  window.__TAURI_INTERNALS__ = {};
  useLiveKitStore.setState({ participants: [
    { ...participant, name: "Alice", isScreenSharing: true },
    { ...participant, identity: "@bob:example.org:PC", name: "Bob" },
  ] });
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  await vue.click('[aria-label="camera.floatPip"]');
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-camera-floating [aria-label="camera.systemPip"]')!.click());
  expect(document.querySelector(".sion-camera-floating")).toBeNull();
  const requests = mock.invoke.mock.calls.filter(([command]) => command === "pip_native_open_streams");
  expect(requests.at(-1)?.[1]).toEqual({ streams: [
    { sender: `camera:${identity}`, name: "Alice" }, { sender: identity, name: "Alice" },
    { sender: "camera:@bob:example.org:PC", name: "Bob" },
  ], focus: identity });
  expect(document.querySelectorAll(".sion-camera-strip canvas")).toHaveLength(0);
  await vue.click('[aria-label="meeting.inApp"]');
  expect(document.querySelectorAll(".sion-camera-floating")).toHaveLength(1);
  expect(document.querySelectorAll(".sion-camera-floating canvas")).toHaveLength(3);
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-camera-floating [aria-label="camera.dockBack"]')!.click());
  expect(document.querySelector(".sion-camera-floating")).toBeNull();
  expect(document.querySelectorAll(".sion-camera-strip canvas")).toHaveLength(2);
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_set_enabled")).toBe(false);
});

it("la fenêtre commune fonctionne avec un partage seul et le raccourci", async () => {
  useLiveKitStore.setState({ participants: [{ ...participant, isCameraEnabled: false, isScreenSharing: true }] });
  await vue.render(<><CameraStrip /><VideoMeeting /></>);
  await act(async () => window.dispatchEvent(new Event("sion-toggle-video-meeting")));
  expect(document.querySelectorAll(".sion-camera-floating canvas")).toHaveLength(1);
  expect(document.querySelector(".sion-camera-strip")).toBeNull();
  await act(async () => window.dispatchEvent(new Event("sion-toggle-video-meeting")));
  expect(document.querySelector(".sion-camera-floating")).toBeNull();
});
