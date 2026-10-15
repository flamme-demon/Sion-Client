import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { reserveTranscriptionEngine } from "./transcriptionEngine";

describe("propriété du moteur de transcription", () => {
  it("réserve dès la préparation et annule avant de toucher Rust", async () => {
    mocks.invoke.mockReset();
    const file = reserveTranscriptionEngine();
    expect(() => reserveTranscriptionEngine()).toThrow("busy");
    await file.stop();
    expect(await file.start("transcribe_start", {})).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    const meeting = reserveTranscriptionEngine();
    await meeting.stop();
  });

  it("un ancien démarrage termine et s'arrête avant le suivant", async () => {
    mocks.invoke.mockReset();
    let resolve!: (port: number) => void;
    mocks.invoke.mockImplementation((command) => command === "transcribe_start"
      ? new Promise<number>((done) => { resolve = done; }) : Promise.resolve(99));
    const first = reserveTranscriptionEngine();
    const starting = first.start("transcribe_start", {});
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const stopping = first.stop();
    const second = reserveTranscriptionEngine();
    const next = second.start("transcribe_start_native", {});
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["transcribe_start"]);
    resolve(42);
    await starting;
    await stopping;
    await next;
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "transcribe_start", "transcribe_stop", "transcribe_start_native",
    ]);
    await first.stop(); // must not stop the new owner
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    await second.stop();
  });

  it("nettoie aussi un démarrage natif partiellement échoué", async () => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "transcribe_start") throw new Error("start failed");
    });
    const file = reserveTranscriptionEngine();
    await expect(file.start("transcribe_start", {})).rejects.toThrow("start failed");
    await file.stop();
    expect(mocks.invoke).toHaveBeenLastCalledWith("transcribe_stop");
  });
});
