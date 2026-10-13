/**
 * One presence model for read receipts and system notifications, initialized
 * at startup in main.tsx. Absence means leaving or hiding the window, or one
 * minute without keyboard/mouse activity.
 *
 * WebKitGTK document.hasFocus can stay false while a native video surface
 * has focus; use Tauri window focus instead of webview blur.
 *
 * Pointer movement alone does not restore presence because it may cross Sion
 * while working on another monitor. Restore on click, keypress or window focus.
 */

/** Without keyboard or mouse activity for this duration, the user is absent. */
const DELAI_ABSENCE_MS = 60_000;

/**
 * On mobile, use page visibility: the screen turns off or backgrounding hides it.
 * Reading without touching the screen is not absence, and Tauri does not track mobile focus.
 */
const SUR_TELEPHONE = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** Events that establish user presence. */
export const EVENEMENTS_ACTIVITE = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "focus"] as const;

/**
 * Active-window gestures restore presence. Hover and scrolling can occur
 * in an inactive window, so they only extend the inactivity deadline.
 */
const GESTES_DE_RETOUR: ReadonlySet<string> = new Set(["pointerdown", "keydown", "touchstart", "focus"]);

/** Window event emitted when Tauri focus changes so presence listeners reevaluate immediately. */
export const EVENEMENT_PRESENCE = "sion:presence";

let fenetreQuittee = false;
let derniereActivite = Date.now();
/** Use Tauri's window focus and ignore webview blur when this signal is available. */
let focusParTauri = false;

if (typeof window !== "undefined") {
  window.addEventListener("blur", () => {
    if (!focusParTauri) fenetreQuittee = true;
  });
  for (const e of EVENEMENTS_ACTIVITE) {
    window.addEventListener(e, () => {
      derniereActivite = Date.now();
      if (GESTES_DE_RETOUR.has(e)) fenetreQuittee = false;
    }, { passive: true });
  }
}

async function suivreFenetreTauri(): Promise<void> {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__ || SUR_TELEPHONE) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const fenetre = getCurrentWindow();
  const signaler = (active: boolean) => {
    fenetreQuittee = !active;
    if (active) derniereActivite = Date.now();
    window.dispatchEvent(new Event(EVENEMENT_PRESENCE));
  };
  await fenetre.onFocusChanged(({ payload }) => signaler(payload));
  focusParTauri = true;
  signaler(await fenetre.isFocused());
}

/** Install Tauri focus tracking at module load. Fall back to webview blur if setup fails. */
export const suiviFenetre: Promise<void> = suivreFenetreTauri().catch((e) => {
  console.warn("[Sion][présence] focus de la fenêtre non suivi :", e);
});

export interface EtatPresence {
  present: boolean;
  visible: boolean;
  quittee: boolean;
  /** Seconds since the last user action. */
  inactifS: number;
}

export function etatPresence(): EtatPresence {
  const visible = document.visibilityState === "visible";
  const inactif = Date.now() - derniereActivite;
  return {
    present: visible && !fenetreQuittee && (SUR_TELEPHONE || inactif < DELAI_ABSENCE_MS),
    visible,
    quittee: fenetreQuittee,
    inactifS: Math.round(inactif / 1000),
  };
}

/** Quelqu'un est devant Sion : inutile de notifier, et ce qui arrive est lu. */
export function utilisateurPresent(): boolean {
  return etatPresence().present;
}

/** Reset tests to a present user at the current time. */
export function reinitialiserPresence(): void {
  fenetreQuittee = false;
  derniereActivite = Date.now();
}
