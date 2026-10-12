import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useSettingsStore } from "../stores/useSettingsStore";
import { restoreCameraEffects } from "./cameraEffectsService";

export const CAMERA_PREVIEW_KEY = "camera:local-preview";
export const cameraKey = (identity: string) => `camera:${identity}`;
export interface CameraDevice { id: string; label: string; front: boolean }
export interface CameraState { previewing: boolean; published: boolean; ready: boolean; deviceId: string | null; error: string | null }
const EMPTY: CameraState = { previewing: false, published: false, ready: false, deviceId: null, error: null };
export const useCameraStore = create<CameraState & { available: boolean | null; busy: boolean; identity: string | null }>(() => ({ ...EMPTY, available: null, busy: false, identity: null }));

let operations = Promise.resolve<unknown>(undefined);
let pending = 0;
let requestVersion = 0;
function serial<T>(action: () => Promise<T>): Promise<T> {
  pending++; useCameraStore.setState({ busy: true });
  const task = operations.catch(() => {}).then(action);
  operations = task;
  return task.finally(() => { pending--; if (!pending) useCameraStore.setState({ busy: false }); });
}

interface AndroidCameraBridge { hasPermission(): boolean; requestPermission(): void; permissionState(): string }
async function permission(version: number): Promise<void> {
  const bridge = (window as Window & { __SION_CAMERA__?: AndroidCameraBridge }).__SION_CAMERA__;
  if (!bridge || bridge.hasPermission()) return;
  bridge.requestPermission();
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (version !== requestVersion) throw new Error("Aperçu annulé.");
    const state = bridge.permissionState();
    if (state === "accordée") return;
    if (state === "refusée") throw new Error("L’accès à la caméra a été refusé.");
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  throw new Error("L’autorisation caméra n’a pas été accordée.");
}

export async function cameraAvailable(): Promise<boolean> {
  const available = await invoke<boolean>("voice_native_camera_available").catch(() => false);
  useCameraStore.setState({ available });
  return available;
}
export function cameraDevices(): Promise<CameraDevice[]> {
  return invoke("voice_native_camera_devices", { ffmpegPath: useSettingsStore.getState().ffmpegPath || null });
}
export function previewCamera(deviceId: string): Promise<CameraState> {
  const version = ++requestVersion;
  return serial(async () => {
    if (version !== requestVersion) throw new Error("Aperçu annulé.");
    await permission(version);
    if (version !== requestVersion) throw new Error("Aperçu annulé.");
    await restoreCameraEffects();
    if (version !== requestVersion) throw new Error("Aperçu annulé.");
    const state = await invoke<CameraState>("voice_native_camera_preview", { deviceId, ffmpegPath: useSettingsStore.getState().ffmpegPath || null });
    useCameraStore.setState(state);
    useSettingsStore.getState().setCameraDeviceId(deviceId);
    return state;
  });
}
export function enableCamera(): Promise<CameraState> {
  return serial(async () => {
    const state = await invoke<CameraState>("voice_native_camera_set_enabled", { enabled: true });
    useCameraStore.setState(state); return state;
  });
}
export function stopCamera(): Promise<void> {
  requestVersion++;
  return serial(async () => {
    await invoke("voice_native_camera_set_enabled", { enabled: false });
    useCameraStore.setState(EMPTY);
  });
}
export async function syncCamera(): Promise<void> {
  if (pending) return;
  const state = await invoke<CameraState>("voice_native_camera_state");
  if (pending) return;
  const current = useCameraStore.getState();
  if (!state.previewing && !state.error) state.error = current.error;
  if (Object.keys(EMPTY).some((key) => current[key as keyof CameraState] !== state[key as keyof CameraState])) useCameraStore.setState(state);
}
export function resetCamera(): void { requestVersion++; useCameraStore.setState({ ...EMPTY, identity: null }); }
