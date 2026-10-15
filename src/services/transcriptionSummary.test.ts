/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../stores/useAppStore", () => ({ useAppStore: { subscribe: vi.fn(), getState: () => ({}) } }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: { getState: () => ({ language: "fr" }) } }));
vi.mock("./matrixService", () => ({ sendSummaryMessage: mocks.send }));
import { summarizeMeeting } from "./transcriptionService";
import { useTranscriptStore } from "../stores/useTranscriptStore";

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  mocks.invoke.mockReset();
  mocks.send.mockClear();
  useTranscriptStore.setState({ summaryState: "idle", sessions: { room: { id: "session-a", ts: 0, startedBy: "alice" } }, entries: {
    room: [{ id: "entry", roomId: "room", senderId: "alice", senderName: "Alice", text: "A decision", t0: 0, t1: 1 }],
  } });
});
describe("summary model lifecycle", () => {
  it("reserves before asset detection and keeps the original meeting identity", async () => {
    let resolve!: (assets: { llama: string; model: string }) => void;
    mocks.invoke.mockImplementation((command) => command === "detect_summary_assets" ? new Promise((done) => { resolve = done; }) : Promise.resolve("minutes"));
    const first = summarizeMeeting("room");
    await summarizeMeeting("room");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    useTranscriptStore.setState({ sessions: { room: { id: "session-b", ts: 10, startedBy: "bob" } } });
    resolve({ llama: "/llama", model: "/model" });
    await first;
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "summarize_transcript")).toHaveLength(1);
    expect(mocks.send).toHaveBeenCalledWith("room", expect.stringContaining("minutes"), "session-a");
    expect(useTranscriptStore.getState().summaryState).toBe("idle");
  });
  it("releases the reservation after a model failure so a retry can run", async () => {
    mocks.invoke.mockImplementation((command) => command === "detect_summary_assets" ? Promise.resolve({ llama: "/llama", model: "/model" }) : Promise.reject(new Error("model failed")));
    await expect(summarizeMeeting("room")).rejects.toThrow("model failed");
    expect(useTranscriptStore.getState().summaryState).toBe("idle");
    mocks.invoke.mockImplementation((command) => Promise.resolve(command === "detect_summary_assets" ? { llama: "/llama", model: "/model" } : "retry minutes"));
    await summarizeMeeting("room");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
