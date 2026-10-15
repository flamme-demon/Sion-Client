interface FullscreenState {
  pending: boolean;
  lastInput: number;
}

const states = new WeakMap<Document, FullscreenState>();
const CLICK_QUIET_MS = 400;

/** Keep one transition per click burst, shared by every video and toolbar. */
export function toggleShareFullscreen(canvas: HTMLCanvasElement): void {
  const frame = canvas.parentElement;
  if (!frame?.isConnected) return;
  const document = canvas.ownerDocument;
  const now = performance.now();
  const state = states.get(document) ?? { pending: false, lastInput: -Infinity };
  states.set(document, state);
  const repeated = now - state.lastInput < CLICK_QUIET_MS;
  state.lastInput = now;
  if (state.pending || repeated) return;

  state.pending = true;
  const settled = () => { state.pending = false; };
  const failed = (error: unknown) => console.warn("[Sion] requestFullscreen failed:", error);
  try {
    // Invoke immediately while the click still carries user activation. Never
    // queue another request after this transition or a cooldown timer.
    const action = document.fullscreenElement === frame
      ? document.exitFullscreen() : frame.requestFullscreen();
    void Promise.resolve(action).catch(failed).finally(settled);
  } catch (error) {
    settled();
    failed(error);
  }
}
