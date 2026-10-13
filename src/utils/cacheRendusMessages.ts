const MAX_ENTREES = 512;
const MAX_TEXTE = 500_000;
const nettoyages = new Set<() => void>();

export function viderCachesRendusMessages(): void {
  for (const vider of nettoyages) vider();
}

/** Cache des transformations pures du chat, partagé entre les remontages.
 * Borné par nombre de messages et par volume de texte. */
export function creerCacheRendus<T>() {
  const cache = new Map<string, T>();
  let volume = 0;
  const vider = () => { cache.clear(); volume = 0; };
  nettoyages.add(vider);
  const memoiser = (source: string, preparer: () => T): T => {
    if (cache.has(source)) {
      const valeur = cache.get(source)!;
      cache.delete(source);
      cache.set(source, valeur);
      return valeur;
    }
    const valeur = preparer();
    if (source.length > MAX_TEXTE) return valeur;
    cache.set(source, valeur);
    volume += source.length;
    while (cache.size > MAX_ENTREES || volume > MAX_TEXTE) {
      const ancien = cache.keys().next().value!;
      volume -= ancien.length;
      cache.delete(ancien);
    }
    return valeur;
  };
  return Object.assign(memoiser, { dispose: () => { nettoyages.delete(vider); vider(); } });
}
