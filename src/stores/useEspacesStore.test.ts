import { beforeEach, expect, it } from "vitest";
import "../test/interface";
import { useEspacesStore } from "./useEspacesStore";
beforeEach(() => { localStorage.clear(); useEspacesStore.setState({ utilisateur: null, hierarchies: {} }); });
it("retrouve les sous-espaces explorés après reprise et sépare les comptes", () => {
  const store = useEspacesStore.getState();
  store.initialiser("@alice:hs"); store.memoriserHierarchie("!A", ["!enfant"]);
  store.initialiser("@bob:hs");
  expect(useEspacesStore.getState().hierarchies).toEqual({});
  store.initialiser("@alice:hs");
  expect(useEspacesStore.getState().hierarchies).toEqual({ "!A": ["!enfant"] });
});
it("limite le catalogue aux 128 derniers espaces explorés", () => {
  const store = useEspacesStore.getState(); store.initialiser("@alice:hs");
  for (let i = 0; i < 140; i++) store.memoriserHierarchie(`!espace${i}`, [`!salon${i}`]);
  expect(Object.keys(useEspacesStore.getState().hierarchies)).toHaveLength(128);
  expect(useEspacesStore.getState().hierarchies["!espace0"]).toBeUndefined();
  expect(useEspacesStore.getState().hierarchies["!espace139"]).toEqual(["!salon139"]);
});
it("réinitialise la rubrique ciblée à la prochaine ouverture et au changement de compte", () => {
  const store = useEspacesStore.getState();
  store.initialiser("@alice:hs");
  store.ouvrir("gerer", "membres");
  expect(useEspacesStore.getState()).toMatchObject({ fenetre: "gerer", rubrique: "membres" });
  store.ouvrir(null);
  store.ouvrir("gerer");
  expect(useEspacesStore.getState().rubrique).toBe("general");
  store.ouvrir("gerer", "membres");
  store.initialiser("@bob:hs");
  expect(useEspacesStore.getState()).toMatchObject({ fenetre: null, rubrique: "general" });
});
