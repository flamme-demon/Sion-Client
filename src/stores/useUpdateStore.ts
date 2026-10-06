import { create } from "zustand";
import { checkForUpdate, type UpdateInfo } from "../services/updateService";
import { useSettingsStore } from "./useSettingsStore";
import { useAppStore } from "./useAppStore";
import { openExternalUrl } from "../utils/openExternal";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "permission" | "error";
interface AndroidUpdateBridge {
  installUpdate(path: string, version: string): string;
  updateInstallState(): string;
}
function androidBridge(): AndroidUpdateBridge | undefined {
  return /Android/.test(navigator.userAgent)
    ? (window as unknown as { __SION__?: AndroidUpdateBridge }).__SION__ : undefined;
}
interface UpdateState {
  update: UpdateInfo | null;
  status: UpdateStatus;
  downloaded: number;
  total: number | null;
  stagedPath: string | null;
  error: string | null;
  dismissed: boolean;
  check: (force?: boolean) => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}
let checkSequence = 0;
let selectedExperimental: boolean | undefined;
let installPoll: ReturnType<typeof setInterval> | undefined;
const busy = (status: UpdateStatus) => ["downloading", "installing", "permission"].includes(status);

export const useUpdateStore = create<UpdateState>((set, get) => ({
  update: null, status: "idle", downloaded: 0, total: null, stagedPath: null, error: null, dismissed: false,
  dismiss: () => set({ dismissed: true }),
  check: async (force = false) => {
    if (busy(get().status)) return;
    const experimental = useSettingsStore.getState().experimentalUpdates;
    const channelChanged = selectedExperimental !== experimental;
    selectedExperimental = experimental;
    const sequence = ++checkSequence;
    const previous = get();
    set({ status: "checking", error: null, ...(force || channelChanged ? { dismissed: false } : {}) });
    try {
      const update = await checkForUpdate(experimental, force);
      if (sequence !== checkSequence || experimental !== useSettingsStore.getState().experimentalUpdates) return;
      const stagedPath = !channelChanged && previous.update?.tag === update?.tag ? previous.stagedPath : null;
      set({ update, stagedPath, status: stagedPath ? "ready" : update ? "available" : "idle",
        ...(previous.update?.tag !== update?.tag ? { dismissed: false } : {}) });
    } catch (error) {
      if (sequence !== checkSequence) return;
      // Never leave an experimental installer visible after opting out.
      set({ update: channelChanged ? null : previous.update, stagedPath: channelChanged ? null : previous.stagedPath,
        status: "error", error: String(error) });
    }
  },
  download: async () => {
    const update = get().update;
    if (!update || busy(get().status) || get().status === "checking") return;
    if (!window.__TAURI_INTERNALS__ || !update.integrated) {
      await openExternalUrl(update.downloadUrl);
      return;
    }
    set({ status: "downloading", downloaded: 0, total: null, error: null, stagedPath: null });
    let unlisten: (() => void) | undefined;
    try {
      const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
      unlisten = await listen<{ tag: string; downloaded: number; total: number | null }>("sion-update-progress", ({ payload }) => {
        if (payload.tag === update.tag) set({ downloaded: payload.downloaded, total: payload.total });
      });
      const stagedPath = await invoke<string>("update_download", { tag: update.tag });
      set({ status: "ready", stagedPath });
    } catch (error) {
      set({ status: "error", error: String(error) });
    } finally {
      unlisten?.();
    }
  },
  install: async () => {
    const { update, stagedPath, status } = get();
    if (!update || !stagedPath || busy(status) || useAppStore.getState().connectedVoiceChannel) return;
    if (update.channel !== "stable" && !useSettingsStore.getState().experimentalUpdates) return;
    set({ status: "installing", error: null });
    try {
      const bridge = androidBridge();
      if (bridge) {
        const result = bridge.installUpdate(stagedPath, update.version);
        if (result.startsWith("error:")) throw new Error(result.slice(6));
        set({ status: result === "permission" ? "permission" : "installing" });
        clearInterval(installPoll);
        installPoll = setInterval(() => {
          const state = bridge.updateInstallState();
          if (state === "permission" || state === "installing") return;
          clearInterval(installPoll);
          if (state.startsWith("error:")) set({ status: "error", error: state.slice(6) });
          else set({ status: "ready" });
        }, 1000);
      } else {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("update_install", { tag: update.tag });
      }
    } catch (error) {
      set({ status: "error", error: String(error) });
    }
  },
}));
