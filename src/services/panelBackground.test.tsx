import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../test/interface";
import { useLayoutStore, type BackgroundScope } from "../stores/useLayoutStore";
import { usePanelBackgroundUrl } from "./panelBackground";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const creer = vi.fn(), revoquer = vi.fn();
const vue = montage();
function Fond({ scope }: { scope: BackgroundScope }) { return <output data-scope={scope}>{usePanelBackgroundUrl(scope)}</output>; }
beforeEach(() => {
  useLayoutStore.setState({ panelBackgrounds: {} });
  let numero = 0;
  creer.mockReset().mockImplementation(() => `blob:fond-${++numero}`); revoquer.mockReset();
  vi.stubGlobal("URL", { createObjectURL: creer, revokeObjectURL: revoquer });
  invoke.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});
afterEach(() => { useLayoutStore.setState({ panelBackgrounds: {} }); vi.unstubAllGlobals(); });
const choisir = (scope: BackgroundScope, path: string | null) => useLayoutStore.getState().setPanelBackground(scope, path ? { path, opacity: 0.55 } : null);

it("partage le fond et ne le révoque qu'après son retrait du dernier module", async () => {
  choisir("chat", "/fond.png"); choisir("members", "/fond.png");
  await vue.render(<><Fond scope="chat" /><Fond scope="members" /></>);
  await vi.waitFor(() => expect(creer).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => choisir("chat", null));
  expect(revoquer).not.toHaveBeenCalled();
  await act(async () => choisir("members", null));
  expect(revoquer).toHaveBeenCalledExactlyOnceWith("blob:fond-1");
});

it("remplacer plusieurs fois un fond libère chaque ancienne URL", async () => {
  choisir("chat", "/fond-0.png"); await vue.render(<Fond scope="chat" />);
  for (let i = 1; i <= 5; i++) await act(async () => choisir("chat", `/fond-${i}.png`));
  await vi.waitFor(() => expect(creer).toHaveBeenCalledTimes(6));
  expect(revoquer).toHaveBeenCalledTimes(5);
});

it("une lecture qui termine après le retrait du fond ne crée aucun blob", async () => {
  let terminer!: (bytes: Uint8Array) => void;
  invoke.mockReturnValue(new Promise((resolve) => { terminer = resolve; }));
  choisir("chat", "/lent.png"); await vue.render(<Fond scope="chat" />);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  await act(async () => { choisir("chat", null); terminer(new Uint8Array([1])); });
  expect(creer).not.toHaveBeenCalled();
});
