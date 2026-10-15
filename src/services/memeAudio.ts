import { getSharedAudioContext } from "./audioContext";
import { playNativeBuffer, type NativePlayback } from "./nativeAudioPlayback";

/** Short mobile overlays keep their pictures in WebView and their sound in Rust. */
export function playMemeVideo(video: HTMLVideoElement, source: string, gain: number, maxSeconds: number): () => void {
  const abort = new AbortController();
  let disposed = false;
  let player: NativePlayback | null = null;
  video.muted = true;
  video.src = source;
  void (async () => {
    let buffer: AudioBuffer | null = null;
    if (gain > 0) {
      try {
        const response = await fetch(source, { signal: abort.signal });
        if (!response.ok) throw new Error(`Meme audio: ${response.status}`);
        buffer = await getSharedAudioContext().decodeAudioData(await response.arrayBuffer());
      } catch {
        // Silent videos and unsupported audio still display without taking focus.
      }
    }
    if (disposed) return;
    if (buffer) {
      player = playNativeBuffer(buffer, 0, Math.min(buffer.duration, maxSeconds), {
        gain,
        onTime: (time) => {
          // The consumed native audio position is the clock for this short clip.
          if (!disposed && video.readyState >= 1 && Math.abs(video.currentTime - time) > 0.15) video.currentTime = time;
        },
      });
      try { await player.ready; }
      catch { player.stop(); player = null; }
    }
    if (!disposed) await video.play();
  })().catch((error) => {
    if (!disposed) console.warn("[Sion][memeboard] lecture mobile", error);
    player?.stop();
  });
  return () => {
    disposed = true;
    abort.abort();
    player?.stop();
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
