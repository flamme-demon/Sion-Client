import { create } from "zustand";
import type { EspaceVocalConserve } from "../utils/bibliotheque";

type VueEspaces = "ajouter" | "gerer" | "parcourir" | null;
interface EtatEspaces {
  utilisateur: string | null;
  espaceActif: string | null;
  fenetre: VueEspaces;
  derniersSalons: Record<string, string>;
  salonsQuittes: string[];
  hierarchies: Record<string, string[]>;
  /** Keep one in-memory voice context; leaving a space preserves its library until the call ends. */
  espaceVocalConserve: EspaceVocalConserve | null;
  initialiser: (utilisateur: string | null) => void;
  choisir: (espace: string | null) => void;
  ouvrir: (fenetre: VueEspaces) => void;
  memoriserSalon: (espace: string | null, salon: string) => void;
  marquerSalonQuitte: (salon: string) => void;
  oublierSalonQuitte: (salon: string) => void;
  memoriserHierarchie: (espace: string, enfants: string[]) => void;
}
const cle = (utilisateur: string) => `sion_espace_actif:${utilisateur}`;
const cleDeparts = (utilisateur: string) => `sion_salons_quittes:${utilisateur}`;
const cleHierarchies = (utilisateur: string) => `sion_hierarchies:${utilisateur}`;
function sauverDeparts(utilisateur: string | null, salons: string[]) {
  try {
    if (utilisateur) localStorage.setItem(cleDeparts(utilisateur), JSON.stringify(salons));
  } catch { /* Respect the departure choice throughout this session. */ }
}
export const useEspacesStore = create<EtatEspaces>((set, get) => ({
  utilisateur: null, espaceActif: null, fenetre: null, derniersSalons: {}, salonsQuittes: [], hierarchies: {}, espaceVocalConserve: null,
  initialiser: (utilisateur) => {
    if (utilisateur === get().utilisateur) return;
    let espaceActif: string | null = null;
    let salonsQuittes: string[] = [];
    let hierarchies: Record<string, string[]> = {};
    try { espaceActif = utilisateur ? localStorage.getItem(cle(utilisateur)) : null; } catch { /* stockage indisponible */ }
    try {
      const departs: unknown = utilisateur ? JSON.parse(localStorage.getItem(cleDeparts(utilisateur)) ?? "[]") : [];
      if (Array.isArray(departs)) salonsQuittes = departs.filter((id): id is string => typeof id === "string");
    } catch { /* stockage indisponible ou ancien contenu invalide */ }
    try {
      const donnees: unknown = utilisateur ? JSON.parse(localStorage.getItem(cleHierarchies(utilisateur)) ?? "{}") : {};
      if (donnees && typeof donnees === "object" && !Array.isArray(donnees)) {
        hierarchies = Object.fromEntries(Object.entries(donnees).filter(([id, ids]) => id.startsWith("!") && Array.isArray(ids))
          .slice(-128).map(([id, ids]) => [id, (ids as unknown[]).filter((v): v is string => typeof v === "string" && v.startsWith("!"))]));
      }
    } catch { /* Reload the catalog on the next opening. */ }
    set({ utilisateur, espaceActif, fenetre: null, derniersSalons: {}, salonsQuittes, hierarchies, espaceVocalConserve: null });
  },
  choisir: (espaceActif) => {
    const utilisateur = get().utilisateur;
    try {
      if (utilisateur) {
        if (espaceActif) localStorage.setItem(cle(utilisateur), espaceActif);
        else localStorage.removeItem(cle(utilisateur));
      }
    } catch { /* Selection remains usable without storage. */ }
    set({ espaceActif });
  },
  ouvrir: (fenetre) => set({ fenetre }),
  memoriserSalon: (espace, salon) => {
    const key = espace ?? "serveur";
    if (get().derniersSalons[key] !== salon) set((s) => ({ derniersSalons: { ...s.derniersSalons, [key]: salon } }));
  },
  marquerSalonQuitte: (salon) => {
    if (get().salonsQuittes.includes(salon)) return;
    const salonsQuittes = [...get().salonsQuittes, salon];
    sauverDeparts(get().utilisateur, salonsQuittes);
    set({ salonsQuittes });
  },
  oublierSalonQuitte: (salon) => {
    if (!get().salonsQuittes.includes(salon)) return;
    const salonsQuittes = get().salonsQuittes.filter((id) => id !== salon);
    sauverDeparts(get().utilisateur, salonsQuittes);
    set({ salonsQuittes });
  },
  memoriserHierarchie: (espace, enfants) => {
    const avant = get().hierarchies[espace];
    if (avant?.length === enfants.length && avant.every((id, i) => id === enfants[i])) return;
    // Cache only links for 128 visited spaces, excluding members and messages.
    const autres = Object.entries(get().hierarchies).filter(([id]) => id !== espace);
    const hierarchies = Object.fromEntries([...autres.slice(-127), [espace, enfants]]);
    const utilisateur = get().utilisateur;
    try { if (utilisateur) localStorage.setItem(cleHierarchies(utilisateur), JSON.stringify(hierarchies)); } catch { /* cache de session */ }
    set({ hierarchies });
  },
}));
