import { afterEach, expect, it, vi } from "vitest";
import { creerCacheRendus, viderCachesRendusMessages } from "./cacheRendusMessages";

afterEach(() => { viderCachesRendusMessages(); });

it("réutilise une transformation et distingue le texte modifié", () => {
  const cache = creerCacheRendus<object>();
  const premier = vi.fn(() => ({ texte: "Bonjour" }));
  const autre = vi.fn(() => ({ texte: "Bonjour !" }));
  const valeur = cache("Bonjour", premier);
  expect(cache("Bonjour", premier)).toBe(valeur);
  expect(premier).toHaveBeenCalledTimes(1);
  expect(cache("Bonjour !", autre)).not.toBe(valeur);
});

it("borne la mémoire et privilégie les messages relus récemment", () => {
  const cache = creerCacheRendus<number>();
  for (let i = 0; i < 512; i++) cache(String(i), () => i);
  cache("0", () => -1);
  cache("nouveau", () => 512);
  expect(cache("0", () => -1)).toBe(0);
  expect(cache("1", () => -1)).toBe(-1);
  const gros = "x".repeat(300_000);
  cache(gros, () => 100);
  cache(gros + "y", () => 101);
  expect(cache(gros, () => -1)).toBe(-1);
  const immense = "x".repeat(500_001);
  cache(immense, () => 5);
  expect(cache(immense, () => 6)).toBe(6);
});

it("efface les textes à la fermeture de session et libère les caches remplacés", () => {
  const cache = creerCacheRendus<number>();
  cache("secret", () => 1);
  viderCachesRendusMessages();
  expect(cache("secret", () => 2)).toBe(2);
  cache.dispose();
  expect(cache("secret", () => 3)).toBe(3);
});
