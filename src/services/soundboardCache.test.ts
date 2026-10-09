import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchSoundFile, invalidateSoundCache, type SoundEntry } from "./soundboardService";

vi.mock("./moteur", () => ({ moteurRust: () => true }));
vi.mock("./matrixCore", () => ({ urlMedia: async (mxc: string) => `https://media.test/${mxc}` }));
vi.mock("./matrixService", () => ({ getMatrixClient: () => null }));
vi.mock("../stores/useAppStore", () => ({ useAppStore: { getState: () => ({}) } }));
const creer = vi.fn(), revoquer = vi.fn(), telecharger = vi.fn();
const son = (id: string) => ({ mxcUrl: id, body: "son.ogg", mimetype: "audio/ogg" } as SoundEntry);
const ids = new Set<string>();
const charger = (id: string) => { ids.add(id); return fetchSoundFile(son(id)); };
beforeEach(() => {
  let numero = 0;
  creer.mockReset().mockImplementation(() => `blob:test-${++numero}`);
  revoquer.mockReset();
  telecharger.mockReset().mockResolvedValue({ ok: true, blob: async () => new Blob(["son"], { type: "audio/ogg" }) });
  vi.stubGlobal("URL", { createObjectURL: creer, revokeObjectURL: revoquer });
  vi.stubGlobal("fetch", telecharger);
});
afterEach(() => { for (const id of ids) invalidateSoundCache(id); ids.clear(); vi.unstubAllGlobals(); });

it("deux lectures simultanées partagent le téléchargement et une seule URL révocable", async () => {
  let terminer!: (reponse: unknown) => void;
  telecharger.mockImplementationOnce(() => new Promise((resolve) => { terminer = resolve; }));
  const premier = charger("mxc://hs/concurrent");
  const second = charger("mxc://hs/concurrent");
  await vi.waitFor(() => expect(telecharger).toHaveBeenCalledOnce());
  terminer({ ok: true, blob: async () => new Blob(["son"]) });
  await Promise.all([premier, second]);
  expect(creer).toHaveBeenCalledOnce();
  expect(telecharger.mock.calls.filter(([url]) => url.startsWith("https:"))).toHaveLength(1);
  invalidateSoundCache("mxc://hs/concurrent");
  expect(revoquer).toHaveBeenCalledExactlyOnceWith("blob:test-1");
});

it("le cache de 24 sons révoque l'entrée évincée, puis la recharge à la demande", async () => {
  for (let i = 0; i < 25; i++) await charger(`mxc://hs/${i}`);
  expect(revoquer).toHaveBeenCalledExactlyOnceWith("blob:test-1");
  await charger("mxc://hs/24");
  expect(creer).toHaveBeenCalledTimes(25);
  await charger("mxc://hs/0");
  expect(creer).toHaveBeenCalledTimes(26);
  expect(revoquer).toHaveBeenCalledTimes(2);
});

it("un téléchargement échoué libère sa demande pour permettre une nouvelle lecture", async () => {
  telecharger.mockRejectedValueOnce(new Error("hors ligne"));
  await expect(charger("mxc://hs/retry")).rejects.toThrow("hors ligne");
  await charger("mxc://hs/retry");
  expect(creer).toHaveBeenCalledOnce();
});
