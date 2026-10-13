import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthCredentials } from "../types/auth";

const mocks = vi.hoisted(() => ({
  connecter: vi.fn(), reprendre: vi.fn(), etatConnexion: vi.fn(),
}));
vi.mock("../services/moteur", () => ({ moteurRust: () => true }));
vi.mock("../i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("./useAdminStore", () => ({ useAdminStore: { getState: () => ({ reset: vi.fn() }) } }));
vi.mock("../services/sessionPersist", () => ({ mirrorSessionToAppData: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn(async () => {}) }));
vi.mock("../services/matrixService", () => ({
  fetchDisplayName: vi.fn(async () => "Alice (server)"),
  getAvatarUrl: vi.fn(async () => null),
  checkSuspended: vi.fn(async () => false),
}));
vi.mock("../services/matrixCore", () => mocks);

const storage: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { for (const key of Object.keys(storage)) delete storage[key]; },
  },
});

const { useAuthStore } = await import("./useAuthStore");
const session: AuthCredentials = {
  homeserverUrl: "https://sionchat.fr", userId: "@alice:sionchat.fr",
  accessToken: "", deviceId: "CURRENT", displayName: "Alice 🌸",
  avatarUrl: "/alice.png", livekitUrl: "wss://voice.sionchat.fr",
};

beforeEach(() => {
  localStorage.clear();
  mocks.connecter.mockReset().mockResolvedValue(undefined);
  mocks.reprendre.mockReset().mockResolvedValue(true);
  mocks.etatConnexion.mockReset().mockResolvedValue({
    etat: "connecte", utilisateur: session.userId, appareil: session.deviceId,
  });
  useAuthStore.setState({ credentials: null, error: null, isLoading: false, keyringUnavailable: false });
});

describe("native authentication after retiring 1.x migration", () => {
  it("signs in normally even when stale 1.x metadata remains", async () => {
    localStorage.setItem("sion_auth_credentials", JSON.stringify({
      ...session, accessToken: "old-token", deviceId: "OLD", displayName: "Old name",
    }));
    await useAuthStore.getState().login(session.homeserverUrl, "alice", "password");
    expect(mocks.connecter).toHaveBeenCalledExactlyOnceWith(session.homeserverUrl, "alice", "password");
    expect(useAuthStore.getState().credentials).toMatchObject({
      userId: session.userId, deviceId: session.deviceId, accessToken: "", displayName: "Alice (server)",
    });
    expect(localStorage.getItem("sion_auth_credentials_rust")).not.toContain("old-token");
  });

  it("does not save a session after a rejected password", async () => {
    mocks.connecter.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
    await expect(useAuthStore.getState().login(session.homeserverUrl, "alice", "wrong")).rejects.toThrow();
    expect(useAuthStore.getState().credentials).toBeNull();
    expect(localStorage.getItem("sion_auth_credentials_rust")).toBeNull();
  });

  it("restores the current native device and local profile without signing in again", async () => {
    localStorage.setItem("sion_auth_credentials_rust", JSON.stringify(session));
    await useAuthStore.getState().restoreSession();
    expect(mocks.reprendre).toHaveBeenCalledOnce();
    expect(mocks.connecter).not.toHaveBeenCalled();
    expect(useAuthStore.getState().credentials).toEqual(session);
  });

  it("uses the current server profile instead of obsolete JS profile metadata", async () => {
    localStorage.setItem("sion_auth_credentials", JSON.stringify({
      ...session, displayName: "Obsolete profile", deviceId: "OLD", accessToken: "old-token",
    }));
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().credentials).toMatchObject({
      deviceId: session.deviceId, displayName: "Alice (server)", accessToken: "",
    });
    expect(mocks.connecter).not.toHaveBeenCalled();
  });

  it("keeps the native profile and device while resuming offline", async () => {
    localStorage.setItem("sion_auth_credentials_rust", JSON.stringify(session));
    mocks.etatConnexion.mockResolvedValue({ etat: "erreur", message: "offline" });
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().credentials).toEqual(session);
    expect(mocks.connecter).not.toHaveBeenCalled();
  });

  it("preserves saved metadata when the system keyring is unavailable", async () => {
    localStorage.setItem("sion_auth_credentials_rust", JSON.stringify(session));
    mocks.reprendre.mockRejectedValueOnce(new Error("trousseau du système indisponible : locked"));
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().keyringUnavailable).toBe(true);
    expect(localStorage.getItem("sion_auth_credentials_rust")).toBe(JSON.stringify(session));
    expect(mocks.connecter).not.toHaveBeenCalled();
  });

  it("does not revive an old JS session when no native session exists", async () => {
    localStorage.setItem("sion_auth_credentials", JSON.stringify({ ...session, accessToken: "old-token" }));
    mocks.reprendre.mockResolvedValueOnce(false);
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().credentials).toBeNull();
    expect(mocks.connecter).not.toHaveBeenCalled();
  });
});
