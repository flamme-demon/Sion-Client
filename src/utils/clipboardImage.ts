/**
 * Read clipboard images through Rust when HTML5 paste exposes no file.
 * WebKitGTK omits image clipboard items, unlike Chromium. Rust returns original
 * PNG/JPEG/WebP/GIF bytes via binary IPC without decoding or re-encoding.
 */
import { readDroppedFile } from "./droppedFile";

/**
 * File managers copy paths rather than image pixels. Preserve names and formats
 * and prepare every attachment; screenshots use the bitmap fallback below.
 */
export async function readClipboardFiles(): Promise<File[]> {
  const files: File[] = [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const paths = await invoke<string[]>("read_clipboard_files");
    for (const path of paths) {
      const file = await readDroppedFile(path);
      if (file) files.push(file);
    }
  } catch {
    // Try image fallback for an older binary or a clipboard without files.
  }
  if (files.length) return files;
  const image = await readClipboardImageFile();
  return image ? [image] : [];
}

function detectMime(bytes: Uint8Array): string {
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  return "image/png";
}

async function readClipboardImageFile(): Promise<File | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const buffer = await invoke<ArrayBuffer>("read_clipboard_image");
    if (!buffer || buffer.byteLength === 0) return null;
    const bytes = new Uint8Array(buffer);
    const mime = detectMime(bytes);
    const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    return new File([bytes], `presse-papiers-${Date.now()}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}
