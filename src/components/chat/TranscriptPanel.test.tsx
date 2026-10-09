import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { useAppStore } from "../../stores/useAppStore";
import { useTranscriptStore, type TranscriptEntry } from "../../stores/useTranscriptStore";
import { TranscriptPanel } from "./TranscriptPanel";

const services = vi.hoisted(() => ({
  arm: vi.fn().mockResolvedValue(undefined), disarm: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined), summarize: vi.fn().mockResolvedValue(undefined),
  backfill: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock("../../services/matrixService", () => ({ backfillTranscript: services.backfill }));
vi.mock("../../services/transcriptionService", () => ({
  armTranscription: services.arm, disarmTranscription: services.disarm,
  endSessionForAll: services.end, summarizeMeeting: services.summarize,
}));

const vue = montage();
let redimensionner: () => void;
const segment = (id: string, sessionId = "direct"): TranscriptEntry => ({
  id, roomId: "!vocal", sessionId, senderId: "@emma:hs", senderName: "Emma",
  text: `Texte intégral de ${id}\nDeuxième ligne de la transcription.`, t0: 100, t1: 200,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { redimensionner = callback; }
    observe() {}
    disconnect() {}
  });
  useAppStore.setState({ connectedVoiceChannel: "!vocal" });
  useTranscriptStore.setState({
    state: "on", error: null, downloadPct: null, armedPeers: [], summaryState: "idle",
    sessions: { "!vocal": { id: "direct", ts: 100, startedBy: "@emma:hs" } },
    history: { "!vocal": [{ id: "ancien", ts: 10, endedAt: 90, startedBy: "@emma:hs" }] },
    entries: { "!vocal": [segment("ancien-texte", "ancien"), segment("direct-texte")] },
    summaries: {},
  });
});
const defiler = async (liste: HTMLDivElement, haut: number) => {
  await act(async () => { liste.scrollTop = haut; liste.dispatchEvent(new Event("scroll", { bubbles: true })); });
};

it("suit le direct pendant un redimensionnement et respecte la relecture d'un ancien passage", async () => {
  await vue.render(<TranscriptPanel />);
  const liste = vue.container.querySelector<HTMLDivElement>(".sion-transcript-liste")!;
  Object.defineProperties(liste, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 100 } });
  await act(async () => redimensionner());
  expect(liste.scrollTop).toBe(1000);
  await defiler(liste, 200);
  Object.defineProperty(liste, "scrollHeight", { configurable: true, value: 1400 });
  await act(async () => { redimensionner(); useTranscriptStore.getState().addEntry(segment("nouveau")); });
  expect(liste.scrollTop).toBe(200);
  expect(liste.textContent).toContain("Texte intégral de nouveau\nDeuxième ligne");
  await defiler(liste, 1300);
  await act(async () => redimensionner());
  expect(liste.scrollTop).toBe(1400);
});

it("ouvre une ancienne session depuis le début puis reprend le suivi quand on revient au direct", async () => {
  await vue.render(<TranscriptPanel />);
  await vue.click('.sion-transcript-entete button:nth-child(2)');
  await vue.click('.sion-transcript-session');
  const liste = vue.container.querySelector<HTMLDivElement>(".sion-transcript-liste")!;
  expect(liste.scrollTop).toBe(0);
  expect(liste.textContent).toContain("ancien-texte");
  expect(liste.textContent).not.toContain("direct-texte");
  Object.defineProperty(liste, "scrollHeight", { value: 900 });
  await vue.click('.sion-transcript-entete button:first-child');
  expect(liste.textContent).toContain("direct-texte");
  expect(liste.textContent).not.toContain("ancien-texte");
  expect(liste.scrollTop).toBe(900);
});

it("affiche le menu hors du module et permet de le fermer au clavier ou d'arrêter son micro", async () => {
  await vue.render(<TranscriptPanel />);
  await vue.click('[aria-haspopup="menu"]');
  const menu = document.body.querySelector<HTMLDivElement>('[role="menu"]')!;
  expect(menu.parentElement).toBe(document.body);
  expect(vue.container.contains(menu)).toBe(false);
  const boutons = menu.querySelectorAll<HTMLButtonElement>('button');
  expect(document.activeElement).toBe(boutons[0]);
  await act(async () => boutons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(boutons[1]);
  await act(async () => boutons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(vue.container.querySelector('[aria-haspopup="menu"]'));
  await vue.click('[aria-haspopup="menu"]');
  await act(async () => document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
  expect(services.disarm).toHaveBeenCalledWith("!vocal");
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
});
