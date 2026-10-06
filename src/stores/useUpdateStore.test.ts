import type { UpdateInfo } from "../services/updateService";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  check: vi.fn(), invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), open: vi.fn(),
  settings: { experimentalUpdates: false }, app: { connectedVoiceChannel: null as string | null },
}));
vi.mock("../services/updateService", () => ({ checkForUpdate: mocks.check }));
vi.mock("./useSettingsStore", () => ({ useSettingsStore: { getState: () => mocks.settings } }));
vi.mock("./useAppStore", () => ({ useAppStore: { getState: () => mocks.app } }));
vi.mock("../utils/openExternal", () => ({ openExternalUrl: mocks.open }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
const update: UpdateInfo = { tag: "v2.0.0-beta.8", version: "2.0.0-beta.8", channel: "beta", notes: "", releaseUrl: "https://example.com/release", integrated: true, downloadUrl: "https://example.com/Sion.exe" };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.settings.experimentalUpdates = true; mocks.app.connectedVoiceChannel = null;
  mocks.listen.mockResolvedValue(mocks.unlisten);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});
afterEach(() => { delete window.__TAURI_INTERNALS__; });
describe("update lifecycle", () => {
  it("stages a download without installing, then installs only on request", async () => {
    const { useUpdateStore: store } = await import("./useUpdateStore");
    mocks.check.mockResolvedValue(update); mocks.invoke.mockResolvedValue("/cache/package.bin");
    await store.getState().check(); await store.getState().download();
    expect(store.getState().status).toBe("ready");
    expect(mocks.invoke.mock.calls.map((call) => call[0])).toEqual(["update_download"]);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    await store.getState().install();
    expect(mocks.invoke).toHaveBeenLastCalledWith("update_install", { tag: update.tag });
  });
  it("blocks installation during a voice call", async () => {
    const { useUpdateStore: store } = await import("./useUpdateStore");
    store.setState({ update, stagedPath: "/cache/package.bin", status: "ready" });
    mocks.app.connectedVoiceChannel = "!call:example.com";
    await store.getState().install(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("clears an experimental package after opting out, even offline", async () => {
    const { useUpdateStore: store } = await import("./useUpdateStore");
    mocks.check.mockResolvedValue(update); await store.getState().check();
    store.setState({ stagedPath: "/cache/package.bin", status: "ready" });
    mocks.settings.experimentalUpdates = false; mocks.check.mockRejectedValue(new Error("offline"));
    await store.getState().check();
    expect(store.getState().update).toBeNull(); expect(store.getState().stagedPath).toBeNull();
  });
  it("keeps installation available for retry after an installer failure", async () => {
    const { useUpdateStore: store } = await import("./useUpdateStore");
    store.setState({ update, stagedPath: "/cache/package.bin", status: "ready" });
    mocks.invoke.mockRejectedValueOnce(new Error("permission denied"));
    await store.getState().install();
    expect(store.getState().status).toBe("error"); expect(store.getState().stagedPath).toBeTruthy();
    mocks.invoke.mockResolvedValueOnce(undefined); await store.getState().install();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
  it("ignores a stale check after changing channel", async () => {
    const { useUpdateStore: store } = await import("./useUpdateStore");
    let resolve!: (value: unknown) => void;
    mocks.check.mockImplementationOnce(() => new Promise((r) => { resolve = r; })).mockResolvedValueOnce(null);
    const oldCheck = store.getState().check();
    mocks.settings.experimentalUpdates = false; await store.getState().check();
    resolve(update); await oldCheck;
    expect(store.getState().update).toBeNull();
  });
});
