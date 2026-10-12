import { beforeEach, expect, it, vi } from "vitest";
import "../test/interface";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
import { applyCameraEffects, importCameraBackground, restoreCameraEffects } from "./cameraEffectsService";
import { useSettingsStore } from "../stores/useSettingsStore";
import { DEFAULT_CAMERA_EFFECTS } from "../types/cameraEffects";

beforeEach(() => {
  mock.invoke.mockReset(); mock.invoke.mockResolvedValue(undefined);
  useSettingsStore.getState().setCameraEffects({ ...DEFAULT_CAMERA_EFFECTS });
});
it("coalesce les réglages rapides et ne mémorise que ceux acceptés par Rust", async () => {
  const first = applyCameraEffects({ ...DEFAULT_CAMERA_EFFECTS, filter: "vhs" });
  const last = applyCameraEffects({ ...DEFAULT_CAMERA_EFFECTS, filter: "mono" });
  await Promise.all([first, last]);
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  expect(useSettingsStore.getState().cameraEffects.filter).toBe("mono");
  mock.invoke.mockRejectedValueOnce(new Error("Fond illisible"));
  await expect(applyCameraEffects({ ...DEFAULT_CAMERA_EFFECTS, background: "image" })).rejects.toThrow("Fond illisible");
  expect(useSettingsStore.getState().cameraEffects.filter).toBe("mono");
});
it("restaure les préférences sans activer la caméra", async () => {
  useSettingsStore.getState().setCameraEffects({ ...DEFAULT_CAMERA_EFFECTS, accessory: "glasses" });
  mock.invoke.mockImplementation((command: string) => Promise.resolve(command === "voice_native_camera_effects_available" ? true : undefined));
  await restoreCameraEffects();
  expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual(["voice_native_camera_effects_available", "voice_native_camera_effects_set"]);
  expect(mock.invoke).toHaveBeenLastCalledWith("voice_native_camera_effects_set", { settings: { ...DEFAULT_CAMERA_EFFECTS, accessory: "glasses" } });
});
it("transporte le fond une fois en binaire et refuse les fichiers trop lourds", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const file = { name: "fond.MP4", size: 3, arrayBuffer: vi.fn().mockResolvedValue(bytes) } as unknown as File;
  mock.invoke.mockResolvedValue("/cache/fond.gif");
  expect(await importCameraBackground(file)).toBe("/cache/fond.gif");
  expect(mock.invoke).toHaveBeenCalledWith("voice_native_camera_background_import", bytes, { headers: { "x-sion-camera-extension": "mp4" } });
  const large = { name: "fond.png", size: 41 * 1024 * 1024, arrayBuffer: vi.fn() } as unknown as File;
  await expect(importCameraBackground(large)).rejects.toThrow("40 Mo");
  expect(large.arrayBuffer).not.toHaveBeenCalled();
});
