import { montage } from "../../test/interface";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { UserContextMenu } from "./UserContextMenu";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAdminStore } from "../../stores/useAdminStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useLiveKitStore } from "../../stores/useLiveKitStore";
import type { SionMemberVersion } from "../../services/matrixService";

const serveur = vi.hoisted(() => ({ pouvoir: 100, versions: [] as SionMemberVersion[], lire: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("../../services/moteur", () => ({ moteurRust: () => false }));
vi.mock("../../services/matrixService", () => ({
  getUserPowerLevel: () => serveur.pouvoir, getMemberPowerLevel: () => 0, getMatrixClient: () => null,
  getRoomClientVersions: (salon: string) => { serveur.lire(salon); return serveur.versions; },
}));

const vue = montage();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  serveur.pouvoir = 100;
  serveur.versions = [];
  useAdminStore.setState({ isAdmin: false });
  useAuthStore.setState({ credentials: null });
  useAppStore.setState({ activeChannel: "!salon", connectedVoiceChannel: null });
  useMatrixStore.setState({ pinnedVersion: 0 });
  useLiveKitStore.setState({ participants: [] });
});
const version = () => vue.container.querySelector("[data-version-client]");
const rendre = () => vue.render(<UserContextMenu userId="@alice:hs:APPAREIL" userName="Alice" x={200} y={100} onClose={vi.fn()} />);

it("le clic droit affiche la version du bon utilisateur, même depuis son appareil vocal", async () => {
  serveur.versions = [
    { userId: "@bob:hs", version: "1.0", os: "Windows", ts: 2 },
    { userId: "@alice:hs", version: "2.0.0-beta.8", os: "Linux", ts: 1 },
  ];
  await rendre();
  expect(version()?.textContent).toBe("members.clientVersion2.0.0-beta.8 · Linux");
  expect(serveur.lire).toHaveBeenCalledWith("!salon");
});

it.each([0, 50])("la visibilité reste réservée aux administrateurs (niveau %i)", async (pouvoir) => {
  serveur.pouvoir = pouvoir;
  await rendre();
  expect(version()).toBeNull();
  expect(serveur.lire).not.toHaveBeenCalled();
});

it("une annonce Rust arrivée après ouverture remplace « Non annoncée »", async () => {
  await rendre();
  expect(version()?.textContent).toContain("members.clientVersionUnknown");
  serveur.versions = [{ userId: "@alice:hs", version: "2.1.0", os: "?", ts: 1 }];
  await act(async () => useMatrixStore.setState({ pinnedVersion: 1 }));
  expect(version()?.textContent).toBe("members.clientVersion2.1.0");
});
