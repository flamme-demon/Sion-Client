import { useEffect } from "react";
import { create } from "zustand";
import type { PanneauId } from "../../stores/useLayoutStore";

const useCompteurs = create<{ valeurs: Partial<Record<PanneauId, number>> }>(() => ({ valeurs: {} }));

/** Le corps publie son total ; aucun chargement supplémentaire pour le titre. */
export function useCompteurPanneau(id: PanneauId, total: number) {
  useEffect(() => {
    useCompteurs.setState((s) => ({ valeurs: { ...s.valeurs, [id]: total } }));
    return () => useCompteurs.setState((s) => {
      const valeurs = { ...s.valeurs };
      delete valeurs[id];
      return { valeurs };
    });
  }, [id, total]);
}

function useNombreSons() { return useCompteurs((s) => s.valeurs.soundboard ?? null); }
function useNombreMemes() { return useCompteurs((s) => s.valeurs.memeboard ?? null); }
function useNombreMembres() { return useCompteurs((s) => s.valeurs.members ?? null); }

export const PANNEAU_COMPTEURS: Partial<Record<PanneauId, () => number | null>> = {
  soundboard: useNombreSons,
  memeboard: useNombreMemes,
  members: useNombreMembres,
};
