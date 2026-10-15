// Import audio from external-media URLs (YouTube, etc.) via yt-dlp. The Rust
// side downloads to a temp file and returns its bytes; we wrap them in a File
// the existing AudioTrimmer can decode. Only the trimmed clip is ever uploaded.
import { useSettingsStore } from "../stores/useSettingsStore";

export interface UrlMediaInfo {
  /** Duration in seconds (0 if unknown / live). */
  duration: number;
  title: string;
}

/** Probe a URL for duration + title without downloading the media stream. */
async function invokeProbe(command: string, url: string, signal?: AbortSignal): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  if (signal?.aborted) throw new DOMException("Analyse annulée", "AbortError");
  const requestId = crypto.randomUUID();
  const cancel = () => { void invoke("cancel_ytdlp_probe", { requestId }).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const raw = await invoke<string>(command, {
      url, requestId,
      ytdlpPath: useSettingsStore.getState().ytdlpPath || undefined,
    });
    if (signal?.aborted) throw new DOMException("Analyse annulée", "AbortError");
    return raw;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function probeUrlMedia(url: string, signal?: AbortSignal): Promise<UrlMediaInfo> {
  const raw = await invokeProbe("probe_url_media", url, signal);
  const j = JSON.parse(raw);
  return { duration: Number(j.duration) || 0, title: String(j.title || "") };
}

const EXT_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

/** Download the audio (optionally only a [start,end] section in seconds for
 *  long videos) and return it as a File ready for the trimmer. */
export async function importUrlAudio(
  url: string,
  range?: { start: number; end: number },
): Promise<File> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("import_url_audio", {
    url,
    ytdlpPath: useSettingsStore.getState().ytdlpPath || undefined,
    ffmpegPath: useSettingsStore.getState().ffmpegPath || undefined,
    startSec: range?.start,
    endSec: range?.end,
  });
  const j = JSON.parse(raw);
  const ext: string = j.ext || "webm";
  const bin = atob(j.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `import.${ext}`, { type: EXT_MIME[ext] || "audio/*" });
}

interface VideoFormatOption {
  height: number;
  /** "VP9" | "H.264" | "AV1" | "?" */
  codec: string;
  ext: string;
  /** Estimated total size (video + audio) in bytes, for the FULL video. */
  size: number;
}

export interface UrlFormatsInfo {
  duration: number;
  title: string;
  options: VideoFormatOption[];
}

/** Probe a video URL for duration, title and available resolutions (no download). */
export async function probeUrlFormats(url: string, signal?: AbortSignal): Promise<UrlFormatsInfo> {
  const raw = await invokeProbe("probe_url_formats", url, signal);
  const j = JSON.parse(raw);
  return {
    duration: Number(j.duration) || 0,
    title: String(j.title || ""),
    options: Array.isArray(j.options) ? j.options : [],
  };
}

const VIDEO_EXT_MIME: Record<string, string> = { webm: "video/webm", mp4: "video/mp4", mkv: "video/x-matroska" };
// Keep recodeWebm for command compatibility; it now requests AV1/MP4 encoding.

/** Sanitize a title into a safe, short filename base. */
function safeName(title: string | undefined): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars from filenames is the point
  const base = (title || "video").replace(/[/\\?%*:|"<>\x00-\x1f]/g, "").trim().slice(0, 80);
  return base || "video";
}

export interface VideoImportProgress {
  /** "download" | "convert" */
  phase: string;
  pct: number;
}

/** Cancel the current link import, including download or conversion. */
export async function annulerImportVideo(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("import_url_video_annuler").catch(() => {});
}

/** Download a video at a chosen max height (codec auto, AV1 preferred when available), with an
 *  optional [start,end] section and a server upload-size guard. Returns a File. */
export async function importUrlVideo(
  url: string,
  opts: { height: number; start?: number; end?: number; maxBytes?: number; recodeWebm?: boolean; title?: string; durationSec?: number },
  onProgress?: (p: VideoImportProgress) => void,
): Promise<File> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = onProgress
    ? await listen<VideoImportProgress>("video-import-progress", (e) => onProgress(e.payload))
    : null;
  let raw: string;
  try {
    raw = await invoke<string>("import_url_video", {
      url,
      ytdlpPath: useSettingsStore.getState().ytdlpPath || undefined,
      ffmpegPath: useSettingsStore.getState().ffmpegPath || undefined,
      height: opts.height,
      startSec: opts.start,
      endSec: opts.end,
      maxBytes: opts.maxBytes,
      recodeWebm: opts.recodeWebm,
      durationSec: opts.durationSec,
    });
  } finally {
    unlisten?.();
  }
  const j = JSON.parse(raw);
  const ext: string = j.ext || "mp4";
  const bin = atob(j.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `${safeName(opts.title)}.${ext}`, { type: VIDEO_EXT_MIME[ext] || "video/*" });
}
