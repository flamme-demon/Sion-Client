import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => vi.fn());
const clearMessages = vi.hoisted(() => vi.fn());
const stopPlayer = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
vi.mock("../utils/messageCache", () => ({ clearCache: clearMessages }));
vi.mock("./lecteurActif", () => ({ definirLecteurActif: stopPlayer }));
import { purgerCachesApplication } from "./purgeCache";

beforeEach(() => {
  vi.clearAllMocks();
  native.mockResolvedValue(3);
  clearMessages.mockResolvedValue(undefined);
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

it("attend la purge des deux caches natifs avant le cache de messages, en préservant la session et les préférences", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  const wipePreferences = vi.spyOn(Storage.prototype, "clear");
  const removeDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase: removeDatabase });
  try {
    await purgerCachesApplication();
    expect(stopPlayer).toHaveBeenCalledWith(null);
    expect(native).toHaveBeenCalledWith("purger_caches_medias");
    expect(clearMessages).toHaveBeenCalledOnce();
    expect(native.mock.invocationCallOrder[0]).toBeLessThan(clearMessages.mock.invocationCallOrder[0]);
    expect(wipePreferences).not.toHaveBeenCalled();
    expect(removeDatabase).not.toHaveBeenCalled();
  } finally { wipePreferences.mockRestore(); vi.unstubAllGlobals(); }
});

it("remonte un échec natif et ne prétend pas avoir tout nettoyé", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  native.mockRejectedValue(new Error("disque"));
  await expect(purgerCachesApplication()).rejects.toThrow("disque");
  expect(clearMessages).not.toHaveBeenCalled();
});

it("nettoie le cache de messages hors Tauri sans appeler de commande native", async () => {
  await purgerCachesApplication();
  expect(native).not.toHaveBeenCalled();
  expect(clearMessages).toHaveBeenCalledOnce();
});
