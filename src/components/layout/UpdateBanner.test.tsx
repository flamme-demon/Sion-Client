import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({ connectedVoiceChannel: null as string | null }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { resolvedLanguage: "en" },
  t: (key: string, values?: Record<string, string>) => key === "update.transfer" ? `${values?.downloaded} / ${values?.total}` :
    key === "update.received" ? `${values?.downloaded} received` : key,
}) }));
vi.mock("../../services/updateService", () => ({ checkForUpdate: vi.fn(async () => null) }));
vi.mock("../../utils/openExternal", () => ({ openExternalUrl: vi.fn() }));
// Real stores access localStorage at module load.
vi.mock("../../stores/useSettingsStore", () => {
  const etat = { experimentalUpdates: true };
  const store = (pick: (s: typeof etat) => unknown) => pick(etat);
  return { useSettingsStore: Object.assign(store, { getState: () => etat }) };
});
vi.mock("../../stores/useAppStore", () => {
  const store = (pick: (s: typeof appState) => unknown) => pick(appState);
  return { useAppStore: Object.assign(store, { getState: () => appState }) };
});

import { UpdateBanner } from "./UpdateBanner";
import { useUpdateStore } from "../../stores/useUpdateStore";

const NOTES = `# Sion Client 2.0.0-beta.8

Sion sait désormais se mettre à jour tout seul, et le
téléphone gagne le plein écran.

## Vidéos

- **Windows, plein écran** : la vidéo ne saccade plus.
- Une <img src=x onerror=alert(1)> balise brute.
`;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  appState.connectedVoiceChannel = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function ouvrirNotes() {
  await act(async () => root.render(<UpdateBanner />));
  await act(async () => useUpdateStore.setState({
    status: "available", dismissed: false, stagedPath: null, error: null,
    update: {
      tag: "v2.0.0-beta.8", version: "2.0.0-beta.8", channel: "beta",
      downloadUrl: "https://example.test/a", releaseUrl: "https://example.test/r",
      notes: NOTES, integrated: true,
    },
  }));
  const bouton = [...container.querySelectorAll("button")].find((b) => b.textContent === "update.notes")!;
  await act(async () => bouton.click());
  return container.querySelector('[role="dialog"]') as HTMLElement;
}

it("affiche les notes de version en Markdown, pas en texte brut", async () => {
  const dialog = await ouvrirNotes();
  expect(dialog.querySelector("h1")?.textContent).toBe("Sion Client 2.0.0-beta.8");
  expect(dialog.querySelector("h2")?.textContent).toBe("Vidéos");
  expect(dialog.querySelectorAll("li")).toHaveLength(2);
  expect(dialog.querySelector("li strong")?.textContent).toBe("Windows, plein écran");
  expect(dialog.textContent).not.toContain("##");
  expect(dialog.textContent).not.toContain("**");
  // Wrapped Markdown source stays a single paragraph without line breaks.
  expect(dialog.querySelector("p")?.querySelector("br")).toBeNull();
  // Never interpret raw HTML from release notes.
  expect(dialog.querySelector("img")).toBeNull();
});

it("place le bouton Fermer en haut à gauche, et il ferme la fenêtre", async () => {
  const dialog = await ouvrirNotes();
  const premier = dialog.querySelector("button")!;
  expect(premier.getAttribute("aria-label")).toBe("update.close");
  await act(async () => premier.click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("permet d’installer et relancer pendant un appel vocal", async () => {
  appState.connectedVoiceChannel = "!call:example.test";
  await ouvrirNotes();
  await act(async () => useUpdateStore.setState({ stagedPath: "/cache/package.bin", status: "ready" }));
  const bouton = [...container.querySelectorAll("button")].find((b) => b.textContent === "update.installRelaunch")!;
  expect(bouton.disabled).toBe(false);
  expect(container.textContent).not.toContain("update.finishCall");
  const installer = vi.spyOn(useUpdateStore.getState(), "install").mockResolvedValue();
  try {
    await act(async () => bouton.click());
    expect(installer).toHaveBeenCalledOnce();
  } finally {
    installer.mockRestore();
  }
});

it("keeps downloaded bytes visible when total size and percentage become known", async () => {
  await ouvrirNotes();
  await act(async () => useUpdateStore.setState({ status: "downloading", downloaded: 10_000_000, total: null }));
  const progress = container.querySelector('[role="progressbar"]')!;
  expect(progress.getAttribute("aria-valuenow")).toBeNull();
  expect(container.querySelector(".sion-update-transfer-details")?.textContent).toContain("10.0 MB received");
  await act(async () => useUpdateStore.setState({ total: 40_000_000 }));
  expect(progress.getAttribute("aria-valuenow")).toBe("25");
  expect(container.querySelector(".sion-update-transfer-details")?.textContent).toContain("10.0 MB / 40.0 MB");
  expect(container.querySelector(".sion-update-percent")?.textContent).toBe("25 %");
  expect(container.querySelector("progress")).toBeNull();
});

it("bounds progress to 100 percent and treats zero total as unknown", async () => {
  await ouvrirNotes();
  await act(async () => useUpdateStore.setState({ status: "downloading", downloaded: 30_000_000, total: 20_000_000 }));
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
  await act(async () => useUpdateStore.setState({ total: 0 }));
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBeNull();
  expect(container.querySelector(".sion-update-transfer-details")?.textContent).toContain("30.0 MB received");
});
