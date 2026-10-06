import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareVersions, getAsset, selectUpdate, type Release } from "./updateService";

function release(version: string, extra: Partial<Release> = {}): Release {
  return { tag_name: `v${version}`, assets: [
    { name: `Sion-${version}-x86_64.AppImage`, browser_download_url: "https://example.com/linux" },
    { name: `Sion-${version}_x64-setup.exe`, browser_download_url: "https://example.com/windows" },
    { name: `Sion-${version}-arm64.apk`, browser_download_url: "https://example.com/android" },
    { name: "updater.json", browser_download_url: "https://example.com/updater" },
  ], ...extra };
}
describe("update version selection", () => {
  it("orders all prereleases numerically before stable", () => {
    const versions = ["2.0.0-alpha.2", "2.0.0-alpha.10", "2.0.0-beta.7", "2.0.0-beta.10", "2.0.0-rc.1", "2.0.0", "2.0.1-alpha.1"];
    for (let i = 1; i < versions.length; i++) expect(compareVersions(versions[i], versions[i - 1])).toBe(1);
    expect(compareVersions("v2.0.0+build.1", "2.0.0+build.2")).toBe(0);
  });
  it("keeps previews opt-in even if a release was incorrectly marked stable", () => {
    const releases = [release("2.1.0-alpha.1"), release("2.0.0", { prerelease: false })];
    expect(selectUpdate(releases, "2.0.0-beta.7", false, "linux-x86_64")?.version).toBe("2.0.0");
    expect(selectUpdate(releases, "2.0.0-beta.7", true, "linux-x86_64")?.version).toBe("2.1.0-alpha.1");
  });
  it("ignores publication order, drafts and invalid tags", () => {
    const releases = [release("2.0.0-beta.8"), release("2.0.0-beta.10"), release("3.0.0", { draft: true }), release("latest")];
    expect(selectUpdate(releases, "2.0.0-beta.7", true, "windows-x86_64")?.version).toBe("2.0.0-beta.10");
  });
  it("never downgrades when opting out", () => {
    expect(selectUpdate([release("2.0.0")], "2.1.0-alpha.1", false, "linux-x86_64")).toBeNull();
  });
  it("skips releases whose Android build failed", () => {
    const newest = release("2.0.0-beta.10");
    newest.assets = newest.assets.filter((a) => !a.name.endsWith(".apk"));
    expect(selectUpdate([newest, release("2.0.0-beta.9")], "2.0.0-beta.7", true, "android-aarch64")?.version).toBe("2.0.0-beta.9");
    expect(selectUpdate([newest], "2.0.0-beta.7", true, "linux-x86_64")?.version).toBe("2.0.0-beta.10");
  });
  it("selects a compatible artifact and keeps unsigned old releases manual", () => {
    expect(getAsset(release("2.0.0").assets, "android-aarch64")?.name).toMatch(/arm64.apk$/);
    expect(getAsset(release("2.0.0").assets, "android-x86_64")).toBeUndefined();
    const old = release("2.0.0", { assets: release("2.0.0").assets.slice(0, 3) });
    expect(selectUpdate([old], "1.0.0", false, "windows-x86_64")?.integrated).toBe(false);
  });
});

describe("update cache", () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("__APP_VERSION__", "2.0.0-beta.7"); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("does not cache a network failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true, json: async () => [release("2.0.0")] });
    vi.stubGlobal("fetch", fetch);
    const { checkForUpdate } = await import("./updateService");
    await expect(checkForUpdate()).rejects.toThrow("503");
    expect((await checkForUpdate())?.version).toBe("2.0.0");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses independent channel caches and refreshes on demand", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [release("2.1.0-alpha.1"), release("2.0.0")] });
    vi.stubGlobal("fetch", fetch);
    const { checkForUpdate } = await import("./updateService");
    expect((await checkForUpdate(false))?.version).toBe("2.0.0");
    expect((await checkForUpdate(true))?.version).toBe("2.1.0-alpha.1");
    await checkForUpdate(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    await checkForUpdate(false, true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
