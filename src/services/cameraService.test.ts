import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./cameraEffectsService", () => ({ restoreCameraEffects: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: { getState: () => ({ ffmpegPath: "", setCameraDeviceId: mocks.save }) } }));
import { enableCamera, previewCamera, resetCamera, stopCamera, syncCamera, useCameraStore } from "./cameraService";
const preview = { previewing: true, ready: true, published: false, deviceId: "camera-1", error: null };
const empty = { previewing: false, ready: false, published: false, deviceId: null, error: null };
beforeEach(() => { resetCamera(); mocks.invoke.mockReset(); mocks.save.mockReset(); });
afterEach(() => { delete (window as Window & { __SION_CAMERA__?: unknown }).__SION_CAMERA__; });

it("garde l'aperçu privé jusqu'à l'activation explicite", async () => {
  mocks.invoke.mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, published: true }).mockResolvedValueOnce(empty);
  await previewCamera("camera-1");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke.mock.calls[0][0]).toBe("voice_native_camera_preview");
  expect(useCameraStore.getState().published).toBe(false);
  await enableCamera();
  expect(mocks.invoke).toHaveBeenNthCalledWith(2, "voice_native_camera_set_enabled", { enabled: true });
  expect(useCameraStore.getState().published).toBe(true);
  await stopCamera();
});

it("fermer pendant le démarrage libère la caméra dès que le démarrage finit", async () => {
  let release!: (value: typeof preview) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValueOnce(empty);
  const opening = previewCamera("camera-1");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const closing = stopCamera();
  release(preview);
  await Promise.all([opening, closing]);
  expect(mocks.invoke.mock.calls.map((call) => call[0])).toEqual(["voice_native_camera_preview", "voice_native_camera_set_enabled"]);
  expect(useCameraStore.getState()).toMatchObject({ ...empty, busy: false });
});

it("annuler une autorisation Android en attente empêche toute ouverture tardive", async () => {
  let allowed = false;
  (window as Window & { __SION_CAMERA__?: unknown }).__SION_CAMERA__ = { hasPermission: () => allowed, requestPermission: vi.fn(), permissionState: () => allowed ? "accordée" : "attente" };
  mocks.invoke.mockResolvedValue(empty);
  const opening = previewCamera("camera-1").catch((error: Error) => error);
  await vi.waitFor(() => expect(useCameraStore.getState().busy).toBe(true));
  const closing = stopCamera();
  allowed = true;
  expect(await opening).toBeInstanceOf(Error);
  await closing;
  expect(mocks.invoke.mock.calls.every((call) => call[0] !== "voice_native_camera_preview")).toBe(true);
});

it("retrouve la publication réelle après un rechargement de l'interface", async () => {
  mocks.invoke.mockResolvedValueOnce({ ...preview, published: true });
  await syncCamera();
  expect(useCameraStore.getState()).toMatchObject({ published: true, ready: true });
});
