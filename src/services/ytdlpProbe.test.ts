import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: {
  getState: () => ({ ytdlpPath: "/custom/yt-dlp" }),
} }));
import { probeUrlFormats, probeUrlMedia } from "./ytdlpService";
beforeEach(() => mocks.invoke.mockReset());

describe("link probe ownership", () => {
  it("does not start a request that was cancelled before invocation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(probeUrlFormats("https://video.test/1", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("cancels its exact native request and ignores a late successful result", async () => {
    let resolve!: (result: string) => void;
    mocks.invoke.mockImplementation((command) => command === "probe_url_formats"
      ? new Promise<string>((done) => { resolve = done; }) : Promise.resolve());
    const controller = new AbortController();
    const pending = probeUrlFormats("https://video.test/2", controller.signal);
    const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const request = mocks.invoke.mock.calls[0][1];
    controller.abort();
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_ytdlp_probe", { requestId: request.requestId });
    expect(request.ytdlpPath).toBe("/custom/yt-dlp");
    resolve(JSON.stringify({ title: "late video", options: [] }));
    await failure;
  });
  it("removes cancellation listeners after a successful audio probe", async () => {
    mocks.invoke.mockResolvedValue(JSON.stringify({ duration: 15, title: "audio" }));
    const controller = new AbortController();
    expect(await probeUrlMedia("https://video.test/3", controller.signal)).toEqual({ duration: 15, title: "audio" });
    controller.abort();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][1].requestId).toBeTypeOf("string");
  });
});
