/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { invokeNativeInference } from "./nativeInference";

beforeEach(() => mocks.invoke.mockReset());
describe("native model process ownership", () => {
  it("does not load a model after cancellation during preparation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(invokeNativeInference("tts_generate", {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each(["tts_generate", "summarize_transcript"] as const)("cancels only its %s request and ignores a late result", async (command) => {
    let resolve!: (result: string) => void;
    mocks.invoke.mockImplementation((called) => called === command ? new Promise<string>((done) => { resolve = done; }) : Promise.resolve());
    const controller = new AbortController();
    const pending = invokeNativeInference(command, {}, controller.signal);
    const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const requestId = mocks.invoke.mock.calls[0][1].requestId;
    controller.abort();
    expect(mocks.invoke).toHaveBeenCalledWith(command === "tts_generate" ? "cancel_tts_generation" : "cancel_summary_generation", { requestId });
    resolve("late result");
    await failure;
  });
  it("cancels models on webview close and removes listeners once finished", async () => {
    let reject!: (error: Error) => void;
    mocks.invoke.mockImplementation((command) => command === "summarize_transcript" ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve());
    const pending = invokeNativeInference("summarize_transcript", {});
    const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    window.dispatchEvent(new Event("pagehide"));
    reject(new Error("native process cancelled"));
    await failure;
    mocks.invoke.mockResolvedValue("done");
    const controller = new AbortController();
    await expect(invokeNativeInference("tts_generate", {}, controller.signal)).resolves.toBe("done");
    const count = mocks.invoke.mock.calls.length;
    controller.abort();
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.invoke).toHaveBeenCalledTimes(count);
  });
});
