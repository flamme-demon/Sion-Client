import { create } from "zustand";

export type VueEspaces = "ajouter" | "gerer" | null;
interface EtatEspaces {
  utilisateur: string | null;
  espaceActif: string | null;
  fenetre: VueEspaces;
  derniersSalons: Record<string, string>;
  salonsQuittes: string[];
  initialiser: (utilisateur: string | null) => void;
  choisir: (espace: string | null) => void;
  ouvrir: (fenetre: VueEspaces) => void;
  memoriserSalon: (espace: string | null, salon: string) => void;
  marquerSalonQuitte: (salon: string) => void;
  oublierSalonQuitte: (salon: string) => void;
}
const cle = (utilisateur: string) => `sion_espace_actif:${utilisateur}`;
const cleDeparts = (utilisateur: string) => `sion_salons_quittes:${utilisateur}`;
function sauverDeparts(utilisateur: string | null, salons: string[]) {
  try {
    if (utilisateur) localStorage.setItem(cleDeparts(utilisateur), JSON.stringify(salons));
  } catch { /* Le départ reste respecté pendant cette session. */ }
}
export const useEspacesStore = create<EtatEspaces>((set, get) => ({
  utilisateur: null, espaceActif: null, fenetre: null, derniersSalons: {}, salonsQuittes: [],
  initialiser: (utilisateur) => {
    if (utilisateur === get().utilisateur) return;
    let espaceActif: string | null = null;
    let salonsQuittes: string[] = [];
    try { espaceActif = utilisateur ? localStorage.getItem(cle(utilisateur)) : null; } catch { /* stockage indisponible */ }
    try {
      const departs: unknown = utilisateur ? JSON.parse(localStorage.getItem(cleDeparts(utilisateur)) ?? "[]") : [];
      if (Array.isArray(departs)) salonsQuittes = departs.filter((id): id is string => typeof id === "string");
    } catch { /* stockage indisponible ou ancien contenu invalide */ }
    set({ utilisateur, espaceActif, fenetre: null, derniersSalons: {}, salonsQuittes });
  },
  choisir: (espaceActif) => {
    const utilisateur = get().utilisateur;
    try {
      if (utilisateur) {
        if (espaceActif) localStorage.setItem(cle(utilisateur), espaceActif);
        else localStorage.removeItem(cle(utilisateur));
      }
    } catch { /* la sélection reste utilisable sans stockage */ }
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
}));
