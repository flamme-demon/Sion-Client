import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/useSettingsStore";
import { DEFAULT_CAMERA_EFFECTS, type CameraEffects, type CameraEffectsStatus } from "../types/cameraEffects";
let queue = Promise.resolve<unknown>(undefined);
let version = 0;
export async function cameraEffectsAvailable(): Promise<boolean> {
  return (await invoke<boolean>("voice_native_camera_effects_available").catch(() => false)) === true;
}
export function savedCameraEffects(): CameraEffects { return { ...DEFAULT_CAMERA_EFFECTS, ...useSettingsStore.getState().cameraEffects }; }
export function applyCameraEffects(settings: CameraEffects): Promise<void> {
  const request = ++version;
  const task = queue.catch(() => {}).then(async () => {
    if (request !== version) return;
    await invoke("voice_native_camera_effects_set", { settings });
    if (request === version) useSettingsStore.getState().setCameraEffects(settings);
  });
  queue = task; return task;
}
export async function restoreCameraEffects(): Promise<void> {
  if (await cameraEffectsAvailable()) await applyCameraEffects(savedCameraEffects());
}
export function getCameraEffectsStatus(): Promise<CameraEffectsStatus> { return invoke("voice_native_camera_effects_status"); }
export async function importCameraBackground(file: File): Promise<string> {
  if (file.size > 40 * 1024 * 1024) throw new Error("Le fond doit peser moins de 40 Mo.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov"].includes(extension)) throw new Error("Choisis une image, un GIF ou une vidéo MP4/WebM.");
  const headers: Record<string, string> = { "x-sion-camera-extension": extension };
  const ffmpegPath = useSettingsStore.getState().ffmpegPath;
  if (ffmpegPath && /^[\x20-\x7e]+$/.test(ffmpegPath)) headers["x-sion-ffmpeg-path"] = ffmpegPath;
  return invoke("voice_native_camera_background_import", await file.arrayBuffer(), { headers });
}
