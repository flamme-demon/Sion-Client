import "../test/interface";
import { afterEach, expect, it, vi } from "vitest";
import { __setMatrixClientForTest, rechercherUtilisateurs } from "./matrixService";
import { definirMoteur } from "./moteur";

const contexte = vi.hoisted(() => ({ moi: null as string | null, connus: new Set<string>() }));
const core = vi.hoisted(() => ({ rechercher: vi.fn(), admins: vi.fn(), nom: vi.fn(), avatar: vi.fn() }));
vi.mock("./matrixCore", () => ({ rechercherUtilisateurs: core.rechercher, adminsServeur: core.admins, nomUtilisateur: core.nom, avatarUtilisateur: core.avatar }));
vi.mock("../stores/useMatrixStore", () => ({ useMatrixStore: { getState: () => ({ currentUserId: contexte.moi }) } }));
vi.mock("../stores/usePendingUsersStore", () => ({ usePendingUsersStore: { getState: () => ({ _knownUserIds: contexte.connus }) } }));
afterEach(() => {
  definirMoteur("js"); __setMatrixClientForTest(null); contexte.moi = null; contexte.connus.clear();
  for (const fn of Object.values(core)) fn.mockReset();
});
it("recherche dans le moteur Rust sans ramener les secrets de session dans la webview", async () => {
  definirMoteur("rust");
  core.rechercher.mockResolvedValue({ utilisateurs: [{ userId: "@alice:hs", displayName: "Alice", avatarUrl: null }], limite: true });
  expect(await rechercherUtilisateurs("  Alice  ")).toEqual({ utilisateurs: [{ userId: "@alice:hs", displayName: "Alice", avatarUrl: null }], limite: true });
  expect(core.rechercher).toHaveBeenCalledExactlyOnceWith("Alice");
  expect(await rechercherUtilisateurs("  ")).toEqual({ utilisateurs: [], limite: false });
  expect(core.rechercher).toHaveBeenCalledOnce();
});
it("normalise les profils et avatars de l'annuaire JS et conserve les identifiants exacts", async () => {
  definirMoteur("js");
  const chercher = vi.fn().mockResolvedValue({ results: [
    { user_id: "@alice:hs", display_name: "Alice 🐈", avatar_url: "mxc://hs/image" },
    { user_id: "@ami:ailleurs", display_name: " " },
  ], limited: false });
  __setMatrixClientForTest({ searchUserDirectory: chercher, mxcUrlToHttp: () => "https://hs/media/image" } as unknown as Parameters<typeof __setMatrixClientForTest>[0]);
  expect(await rechercherUtilisateurs(" Ali ")).toEqual({ utilisateurs: [
    { userId: "@alice:hs", displayName: "Alice 🐈", avatarUrl: "https://hs/media/image" },
    { userId: "@ami:ailleurs", displayName: "ami", avatarUrl: null },
  ], limite: false });
  expect(chercher).toHaveBeenCalledExactlyOnceWith({ term: "Ali", limit: 50 });
});

it("retrouve par saisie partielle un compte isolé déjà découvert par l'admin, avec son profil", async () => {
  definirMoteur("rust"); contexte.moi = "@admin:hs";
  contexte.connus.add("@lesolitaire:hs");
  core.admins.mockResolvedValue([contexte.moi]);
  core.rechercher.mockResolvedValue({ utilisateurs: [], limite: false });
  core.nom.mockResolvedValue("Le Solitaire"); core.avatar.mockResolvedValue("sion-media://localhost/photo");
  expect(await rechercherUtilisateurs(" LeSo ")).toEqual({ utilisateurs: [
    { userId: "@lesolitaire:hs", displayName: "Le Solitaire", avatarUrl: "sion-media://localhost/photo" },
  ], limite: false });
  expect(core.nom).toHaveBeenCalledExactlyOnceWith("@lesolitaire:hs");
  expect(core.avatar).toHaveBeenCalledExactlyOnceWith("@lesolitaire:hs");
});

it("ne réutilise pas la liste d'administration pour un membre ordinaire", async () => {
  definirMoteur("rust"); contexte.moi = "@membre:hs";
  contexte.connus.add("@isabelle-isole:hs");
  core.admins.mockResolvedValue(["@admin:hs"]);
  core.rechercher.mockResolvedValue({ utilisateurs: [{ userId: "@isabelle:hs", displayName: "Isabelle", avatarUrl: null }], limite: false });
  expect((await rechercherUtilisateurs("isa")).utilisateurs.map((u) => u.userId)).toEqual(["@isabelle:hs"]);
  expect(core.nom).not.toHaveBeenCalled(); expect(core.avatar).not.toHaveBeenCalled();
});

it("permet à un gestionnaire de retrouver un pseudo exact dont le profil est vérifié", async () => {
  definirMoteur("rust"); contexte.moi = "@membre:hs:8448";
  core.admins.mockResolvedValue([]); core.rechercher.mockResolvedValue({ utilisateurs: [], limite: false });
  core.nom.mockResolvedValue("Alice"); core.avatar.mockResolvedValue(null);
  expect(await rechercherUtilisateurs("@ALICE")).toEqual({ utilisateurs: [{ userId: "@alice:hs:8448", displayName: "Alice", avatarUrl: null }], limite: false });
  expect(core.nom).toHaveBeenCalledExactlyOnceWith("@alice:hs:8448");
});

it("ne propose pas un compte inventé à partir d'une saisie partielle", async () => {
  definirMoteur("rust"); contexte.moi = "@membre:hs";
  core.admins.mockResolvedValue([]); core.rechercher.mockResolvedValue({ utilisateurs: [], limite: false });
  core.nom.mockResolvedValue(null);
  expect(await rechercherUtilisateurs("introuvable")).toEqual({ utilisateurs: [], limite: false });
  expect(core.avatar).not.toHaveBeenCalled();
});

it("évite les doublons, les robots et les comptes de l'ancien serveur", async () => {
  definirMoteur("rust"); contexte.moi = "@admin:hs";
  contexte.connus = new Set(["@alice:hs", "@alice:ancien", "@conduit:hs"]);
  core.admins.mockResolvedValue([contexte.moi]);
  const alice = { userId: "@alice:hs", displayName: "Alice", avatarUrl: "sion-media://localhost/photo" };
  core.rechercher.mockResolvedValue({ utilisateurs: [alice], limite: false });
  expect(await rechercherUtilisateurs("hs")).toEqual({ utilisateurs: [alice], limite: false });
  expect(core.nom).not.toHaveBeenCalled();
});

it("borne le chargement des profils et demande de préciser une recherche trop large", async () => {
  definirMoteur("rust"); contexte.moi = "@admin:hs";
  contexte.connus = new Set(Array.from({ length: 12 }, (_, i) => `@alice${i}:hs`));
  core.admins.mockResolvedValue([contexte.moi]); core.rechercher.mockResolvedValue({ utilisateurs: [], limite: false });
  core.nom.mockResolvedValue(null); core.avatar.mockResolvedValue(null);
  const resultat = await rechercherUtilisateurs("alice");
  expect(resultat.limite).toBe(true); expect(resultat.utilisateurs).toHaveLength(10);
  expect(core.nom).toHaveBeenCalledTimes(10); expect(core.avatar).toHaveBeenCalledTimes(10);
});

it("abandonne les résultats d'une session fermée pendant le chargement du profil", async () => {
  definirMoteur("rust"); contexte.moi = "@admin:hs"; contexte.connus.add("@alice:hs");
  core.admins.mockResolvedValue([contexte.moi]); core.rechercher.mockResolvedValue({ utilisateurs: [], limite: false });
  core.nom.mockImplementation(async () => { contexte.moi = null; return "Alice"; }); core.avatar.mockResolvedValue(null);
  expect(await rechercherUtilisateurs("alice")).toEqual({ utilisateurs: [], limite: false });
});
