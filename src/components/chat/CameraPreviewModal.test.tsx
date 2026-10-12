import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./CameraStream", () => ({ CameraStream: () => <canvas /> }));
import { CameraPreviewModal } from "./CameraPreviewModal";
import { resetCamera, useCameraStore } from "../../services/cameraService";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { DEFAULT_CAMERA_EFFECTS } from "../../types/cameraEffects";
const vue = montage();
const close = vi.fn();
beforeEach(() => {
  resetCamera(); close.mockReset(); mock.invoke.mockReset();
  useSettingsStore.getState().setCameraEffects({ ...DEFAULT_CAMERA_EFFECTS });
  mock.invoke.mockImplementation((cmd: string, args?: { enabled?: boolean }) => {
    if (cmd === "voice_native_camera_effects_available") return Promise.resolve(true);
    if (cmd === "voice_native_camera_effects_status") return Promise.resolve({ ready: true, error: null });
    if (cmd === "voice_native_camera_devices") return Promise.resolve([{ id: "usb", label: "Caméra USB", front: false }]);
    return Promise.resolve({ previewing: true, ready: true, published: args?.enabled === true, deviceId: "usb", error: null });
  });
});
it("ouvre un aperçu et attend le clic Activer avant de publier", async () => {
  await vue.render(<CameraPreviewModal onClose={close} />);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_preview")).toBe(true);
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_set_enabled")).toBe(false);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-camera-activate]')!.click());
  expect(mock.invoke).toHaveBeenCalledWith("voice_native_camera_set_enabled", { enabled: true });
  expect(close).toHaveBeenCalledOnce();
});
it("démonter la fenêtre libère l'aperçu non publié", async () => {
  await vue.render(<CameraPreviewModal onClose={close} />);
  await vue.render(null);
  expect(mock.invoke).toHaveBeenCalledWith("voice_native_camera_set_enabled", { enabled: false });
  expect(useCameraStore.getState().previewing).toBe(false);
});
it("refermer après activation conserve la caméra du vocal", async () => {
  await vue.render(<CameraPreviewModal onClose={close} />);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-camera-activate]')!.click());
  await vue.render(null);
  expect(useCameraStore.getState().published).toBe(true);
  expect(mock.invoke.mock.calls.some(([, args]) => args?.enabled === false)).toBe(false);
});
it("modifier les effets d'une webcam publiée conserve la capture et la publication", async () => {
  useCameraStore.setState({ published: true, previewing: true, ready: true, deviceId: "usb" });
  await vue.render(<CameraPreviewModal onClose={close} />);
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_preview")).toBe(false);
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(4);
  const accessories = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent === "camera.effects.accessory")!;
  await act(async () => accessories.click());
  expect(accessories.getAttribute("aria-selected")).toBe("true");
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_effects_set")).toBe(false);
  expect(document.querySelector('[data-effect-accessory="laugh"]')).not.toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[data-effect-accessory="laugh"]')!.click());
  expect(useSettingsStore.getState().cameraEffects.accessory).toBe("laugh");
  await vue.render(null);
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_set_enabled")).toBe(false);
  expect(useCameraStore.getState().published).toBe(true);
});
it("permet de reprendre l'aperçu après avoir remplacé un fond devenu illisible", async () => {
  useSettingsStore.getState().setCameraEffects({ ...DEFAULT_CAMERA_EFFECTS, background: "image", backgroundPath: "/fond/absent.png" });
  const original = mock.invoke.getMockImplementation()!;
  let fail = true;
  mock.invoke.mockImplementation((cmd: string, args?: { enabled?: boolean }) => {
    if (cmd === "voice_native_camera_effects_set" && fail) { fail = false; return Promise.reject(new Error("Fond illisible")); }
    return original(cmd, args);
  });
  await vue.render(<CameraPreviewModal onClose={close} />);
  expect(document.querySelector('[data-camera-retry]')).not.toBeNull();
  expect(mock.invoke.mock.calls.some(([cmd]) => cmd === "voice_native_camera_preview")).toBe(false);
  await act(async () => document.querySelector<HTMLButtonElement>('.sion-camera-effects-toggle')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-effect-background="blur"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-camera-retry]')!.click());
  expect(useCameraStore.getState()).toMatchObject({ previewing: true, ready: true, published: false });
  expect(useSettingsStore.getState().cameraEffects.background).toBe("blur");
});
