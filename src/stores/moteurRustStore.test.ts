import { afterEach, describe, it, expect, vi } from "vitest";
import { conserverInchanges, contexteSionRust, selectionnerSalonParDefaut } from "./moteurRustStore";
import { useAppStore } from "./useAppStore";
import { useSettingsStore } from "./useSettingsStore";
import { useEspacesStore } from "./useEspacesStore";
import type { Channel } from "../types/matrix";

vi.hoisted(() => {
  const valeurs = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => valeurs.set(cle, valeur),
    removeItem: (cle: string) => valeurs.delete(cle),
    clear: () => valeurs.clear(),
  });
});

describe("salon configuré au démarrage avec plusieurs espaces", () => {
  const appAvant = useAppStore.getState();
  const reglagesAvant = useSettingsStore.getState();
  const espacesAvant = useEspacesStore.getState();
  afterEach(() => { useAppStore.setState(appAvant); useSettingsStore.setState(reglagesAvant); useEspacesStore.setState(espacesAvant); });
  const salon = (id: string, vocal = false): Channel => ({ id, name: id, hasVoice: vocal, voiceUsers: [], createdAt: 0, lastActivity: 0 });
  const channels = [
    { ...salon("!sion"), isSpace: true, spaceChildren: ["!vocal"] },
    { ...salon("!externe"), isSpace: true, spaceChildren: ["!discussion"] },
    salon("!vocal", true), salon("!discussion"),
  ];
  function preparer(defaut = "!vocal") {
    useAppStore.setState({ activeChannel: "", connectedVoiceChannel: null, connectingVoiceChannel: null, pendingAutoJoinVoice: null, mobileView: "sidebar" });
    useSettingsStore.setState({ defaultChannel: defaut, autoJoinVoice: true });
    useEspacesStore.setState({ espaceActif: "!externe", utilisateur: null, hierarchies: {} });
  }
  it("retrouve le vocal choisi dans un autre espace et prépare l'entrée automatique", async () => {
    preparer();
    await selectionnerSalonParDefaut(channels);
    expect(useEspacesStore.getState().espaceActif).toBe("!sion");
    expect(useAppStore.getState().activeChannel).toBe("!vocal");
    expect(useAppStore.getState().pendingAutoJoinVoice).toBe("!vocal");
    expect(useAppStore.getState().connectingVoiceChannel).toBeNull();
    expect(useAppStore.getState().mobileView).toBe("sidebar");
  });
  it("garde l'espace consulté si le salon configuré a disparu", async () => {
    preparer("!supprime");
    await selectionnerSalonParDefaut(channels);
    expect(useEspacesStore.getState().espaceActif).toBe("!externe");
    expect(useAppStore.getState().activeChannel).toBe("!discussion");
    expect(useAppStore.getState().pendingAutoJoinVoice).toBeNull();
  });
  it("respecte un choix manuel intervenu pendant l'initialisation", async () => {
    preparer();
    const initialisation = selectionnerSalonParDefaut(channels);
    useAppStore.setState({ activeChannel: "!discussion" });
    await initialisation;
    expect(useAppStore.getState().activeChannel).toBe("!discussion");
    expect(useAppStore.getState().pendingAutoJoinVoice).toBeNull();
  });
});

const m = (id: string, text: string) => ({ id, text, ts: 1 });

describe("fil republié par le cœur Rust", () => {
  it("garde l'objet d'un message inchangé, remplace celui qui change", () => {
    const avant = [m("a", "un"), m("b", "deux")];
    const apres = conserverInchanges(avant, [m("a", "un"), m("b", "deux (corrigé)"), m("c", "trois")]);
    expect(apres[0]).toBe(avant[0]);
    expect(apres[1]).not.toBe(avant[1]);
    expect(apres[1].text).toBe("deux (corrigé)");
    expect(apres.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("un fil identique garde son tableau : rien à redessiner", () => {
    const avant = [m("a", "un"), m("b", "deux")];
    expect(conserverInchanges(avant, [m("a", "un"), m("b", "deux")])).toBe(avant);
  });

  it("premier fil ou message retiré : pas de réutilisation hasardeuse", () => {
    const apres = [m("a", "un")];
    expect(conserverInchanges([], apres)).toBe(apres);
    const avant = [m("a", "un"), m("b", "deux")];
    const reduit = conserverInchanges(avant, [m("b", "deux")]);
    expect(reduit).not.toBe(avant);
    expect(reduit[0]).toBe(avant[1]);
  });
});

describe("événements propres à Sion, côté moteur Rust", () => {
  it("niveau de l'expéditeur : en cache, sinon détails du salon rechargés", async () => {
    const membre = { userId: "@modo:hs", displayName: "Modo", avatarUrl: null, powerLevel: 50 };
    const details = { membres: [membre], moi: 0, niveauEtat: 50, niveauInvitation: 0, peutEcrire: true, regleAcces: null };
    const core = { detailsSalon: vi.fn(async () => details) };
    const enCache: { details?: typeof details } = {};
    const cache = { detailsSalon: vi.fn(() => enCache.details) };
    const get = () => ({ currentUserId: "@moi:hs" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = contexteSionRust(get as any, core as any, cache as any);
    expect(ctx.moi()).toBe("@moi:hs");
    // Cache vide : une éjection doit quand même connaître le niveau réel.
    expect(await ctx.niveau("!s:hs", "@modo:hs")).toBe(50);
    expect(core.detailsSalon).toHaveBeenCalledWith("!s:hs");
    expect(await ctx.niveau("!s:hs", "@inconnu:hs")).toBe(0);
    enCache.details = details;
    expect(ctx.nom("!s:hs", "@modo:hs")).toBe("Modo");
  });
});
