import { invoke } from "@tauri-apps/api/core";

/** Meetings and files share one model: reserve it before any await. */
export interface TranscriptionEngineLease {
  start(command: "transcribe_start" | "transcribe_start_native", args: Record<string, unknown>): Promise<number | null>;
  stop(): Promise<void>;
}

let owner: TranscriptionEngineLease | null = null;
let commands: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = commands.then(run);
  commands = result.catch(() => {});
  return result;
}

export function reserveTranscriptionEngine(): TranscriptionEngineLease {
  if (owner) throw new Error("busy");
  let cancelled = false;
  let touchedNative = false;
  let stopping: Promise<void> | null = null;
  const lease: TranscriptionEngineLease = {
    start: (command, args) => enqueue(async () => {
      if (cancelled) return null;
      // Even partial startup failures must go through native cleanup.
      touchedNative = true;
      return invoke<number>(command, args);
    }),
    stop: () => {
      if (stopping) return stopping;
      cancelled = true;
      // Queue the stop before allowing another reservation.
      stopping = enqueue(async () => {
        if (touchedNative) {
          await invoke("transcribe_stop");
          touchedNative = false;
        }
      });
      if (owner === lease) owner = null;
      return stopping;
    },
  };
  owner = lease;
  return lease;
}
