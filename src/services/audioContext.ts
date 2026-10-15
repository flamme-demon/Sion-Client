// Shared context for decoding files without connecting to audio output.
// All audible playback goes through Rust.
let shared: OfflineAudioContext | null = null;

export function getSharedAudioContext(): OfflineAudioContext {
  if (!shared) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext) as typeof OfflineAudioContext;
    // Decoding must never open a hardware stream or compete for Android focus.
    shared = new Ctor(2, 1, 48_000);
  }
  return shared;
}
