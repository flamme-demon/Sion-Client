/** Tie a native model process to its request and the webview lifetime. */
export async function invokeNativeInference<T>(
  command: "tts_generate" | "summarize_transcript",
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  if (signal?.aborted) throw new DOMException("Génération annulée", "AbortError");
  const requestId = crypto.randomUUID();
  const cancelCommand = command === "tts_generate" ? "cancel_tts_generation" : "cancel_summary_generation";
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void invoke(cancelCommand, { requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  globalThis.addEventListener?.("pagehide", cancel, { once: true });
  try {
    const result = await invoke<T>(command, { ...args, requestId });
    if (cancelled) throw new DOMException("Génération annulée", "AbortError");
    return result;
  } catch (error) {
    if (cancelled) throw new DOMException("Génération annulée", "AbortError");
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    globalThis.removeEventListener?.("pagehide", cancel);
  }
}
