import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceDisplayName, deviceOperatingSystem, isAutomaticDeviceName } from "./deviceIdentity";

afterEach(() => vi.unstubAllGlobals());

describe("session device identity", () => {
  it.each([
    ["Mozilla/5.0 (Linux; Android 16; Xiaomi 12) AppleWebKit/537.36", 5, "Android", "Mobile"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5, "iOS", "Mobile"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0", 5, "iOS", "Mobile"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)", 0, "macOS", "Desktop"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "Windows", "Desktop"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15", 0, "Linux", "Desktop"],
  ])("labels %s", (userAgent, maxTouchPoints, os, kind) => {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
    expect(deviceOperatingSystem()).toBe(os);
    expect(deviceDisplayName("2.0.1")).toBe(`Sion Client 2.0.1 — ${kind} (${os})`);
  });

  it.each([
    undefined, null, "", "Sion Android", "Sion (moteur Rust)",
    "Sion Client 2.0.0 (Linux)", "Sion Client 2.0.0-beta.9 (Android) — moteur Rust",
    "Sion Client 2.0.1 — Desktop (Windows)", "Sion Client 2.0.1 — Mobile (Android)",
  ])("migrates generated label %s", (name) => {
    expect(isAutomaticDeviceName(name)).toBe(true);
  });

  it.each(["Mon PC", "Téléphone de Flamme", "Sion du salon", "Sion Client perso (Linux)", "Sion Client 2.0.0 (Linux) bureau"]) (
    "preserves personal label %s", (name) => expect(isAutomaticDeviceName(name)).toBe(false),
  );
});
