import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

// jsdom ne fournit pas localStorage dans cette configuration de Vitest.
const valeurs = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => valeurs.get(key) ?? null,
    setItem: (key: string, value: string) => valeurs.set(key, value),
    removeItem: (key: string) => valeurs.delete(key),
    clear: () => valeurs.clear(),
  },
});

export function montage() {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
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
  return {
    get container() { return container; },
    render: async (element: ReactNode) => { await act(async () => root.render(element)); },
    click: async (selector: string) => {
      const button = container.querySelector<HTMLButtonElement>(selector);
      if (!button) throw new Error(`Bouton absent : ${selector}`);
      await act(async () => button.click());
    },
  };
}
