import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../stores/useSettingsStore", () => ({ useSettingsStore: () => true }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.resetModules();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("les messages au même lien partagent une requête, même en StrictMode", async () => {
  const { LinkPreview } = await import("./LinkPreview");
  let finish!: (data: { title: string }) => void;
  invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<StrictMode>{Array.from({ length: 20 }, (_, i) =>
    <LinkPreview key={i} url="https://example.test/article" />)}</StrictMode>));
  expect(invoke).toHaveBeenCalledOnce();
  await act(async () => finish({ title: "Article" }));
  expect(container.querySelectorAll("a")).toHaveLength(20);
  await act(async () => root.render(<LinkPreview url="https://example.test/article" />));
  expect(container.textContent).toBe("Article");
  expect(invoke).toHaveBeenCalledOnce();
});

it("un lien supprimé échoue une fois et ne se relance pas à chaque ouverture", async () => {
  vi.useFakeTimers();
  const { LinkPreview } = await import("./LinkPreview");
  invoke.mockRejectedValue("HTTP 404 Not Found");
  const render = () => act(async () => root.render(<><LinkPreview url="https://example.test/supprime" /><LinkPreview url="https://example.test/supprime" /></>));
  await render();
  expect(invoke).toHaveBeenCalledOnce();
  expect(container.textContent).toBe("");
  await act(async () => root.render(<></>));
  vi.advanceTimersByTime(60_000);
  await render();
  expect(invoke).toHaveBeenCalledOnce();
  await act(async () => root.render(<></>));
  vi.advanceTimersByTime(240_001);
  await render();
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("ne conserve pas l'aperçu du précédent lien pendant le chargement du suivant", async () => {
  const { LinkPreview } = await import("./LinkPreview");
  invoke.mockResolvedValueOnce({ title: "Ancien article" });
  await act(async () => root.render(<LinkPreview url="https://example.test/ancien" />));
  expect(container.textContent).toBe("Ancien article");
  let finir!: (data: { title: string }) => void;
  invoke.mockReturnValueOnce(new Promise((resolve) => { finir = resolve; }));
  await act(async () => root.render(<LinkPreview url="https://example.test/nouveau" />));
  expect(container.querySelector("a")).toBeNull();
  await act(async () => finir({ title: "Nouvel article" }));
  expect(container.textContent).toBe("Nouvel article");
});

it("partage aussi la reprise d'une erreur transitoire et le message d'échec", async () => {
  vi.useFakeTimers();
  const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { LinkPreview } = await import("./LinkPreview");
  invoke.mockRejectedValue("error sending request");
  await act(async () => root.render(<>{Array.from({ length: 8 }, (_, i) =>
    <LinkPreview key={i} url="https://example.test/hors-ligne" />)}</>));
  expect(invoke).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(avertir).toHaveBeenCalledOnce();
  expect(container.querySelector("a")).toBeNull();
});
