import { beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { montage } from "../test/interface";
import { useEspaces } from "./useEspaces";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useEspacesStore } from "../stores/useEspacesStore";

const appels = vi.hoisted(() => ({ rejoindre: vi.fn() }));
vi.mock("../services/espacesService", () => ({ rejoindreSalonsCommuns: appels.rejoindre }));
vi.mock("../i18n", () => ({ default: { t: (cle: string) => cle } }));
const vue = montage();
function Test() { useEspaces(); return null; }
beforeEach(() => { appels.rejoindre.mockReset(); localStorage.clear(); useEspacesStore.setState({ utilisateur: null }); });
it("une synchronisation ou une sélection d'espace n'inscrit plus automatiquement à tous ses salons", async () => {
  useMatrixStore.setState({ currentUserId: "@moi:hs", connectionStatus: "connected", channels: [] });
  await vue.render(<Test />);
  await act(async () => {
    useMatrixStore.setState({ channels: [{ id: "!externe", name: "Manjaro", isSpace: true, spaceChildren: ["!general", "!fr"], membership: "join", hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0 }] });
    useEspacesStore.getState().choisir("!externe");
  });
  expect(appels.rejoindre).not.toHaveBeenCalled();
});
