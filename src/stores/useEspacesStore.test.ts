// @vitest-environment jsdom
import "../test/interface";
import { beforeEach, expect, it } from "vitest";
import { useEspacesStore } from "./useEspacesStore";
beforeEach(() => { localStorage.clear(); useEspacesStore.setState({ utilisateur: null, espaceActif: null, derniersSalons: {}, fenetre: null, salonsQuittes: [] }); });
it("restaure la sélection par compte sans mélanger les équipes entre comptes", () => {
  const s = useEspacesStore.getState();
  s.initialiser("@alice:hs"); s.choisir("!alice"); s.memoriserSalon("!alice", "!chat");
  s.initialiser("@bob:hs"); expect(useEspacesStore.getState().espaceActif).toBeNull(); expect(useEspacesStore.getState().derniersSalons).toEqual({});
  s.choisir("!bob"); s.initialiser("@alice:hs"); expect(useEspacesStore.getState().espaceActif).toBe("!alice");
  s.initialiser(null); expect(useEspacesStore.getState().espaceActif).toBeNull();
});
it("conserve les départs après redémarrage, les isole par compte et permet une jointure volontaire", () => {
  const s = useEspacesStore.getState();
  s.initialiser("@alice:hs"); s.marquerSalonQuitte("!chat"); s.marquerSalonQuitte("!chat");
  s.initialiser(null); s.initialiser("@alice:hs");
  expect(useEspacesStore.getState().salonsQuittes).toEqual(["!chat"]);
  s.initialiser("@bob:hs"); expect(useEspacesStore.getState().salonsQuittes).toEqual([]);
  s.initialiser("@alice:hs"); s.oublierSalonQuitte("!chat");
  s.initialiser(null); s.initialiser("@alice:hs");
  expect(useEspacesStore.getState().salonsQuittes).toEqual([]);
});
