import { create } from "zustand";
import { useLayoutStore, type PanneauId, type ZonePanneau } from "../../stores/useLayoutStore";

export interface PlacementModule {
  zone: ZonePanneau;
  avant?: PanneauId;
}

export const LIBELLES_PLACEMENT: Record<ZonePanneau, string> = {
  left: "layout.panelLeft", right: "layout.panelRight", top: "layout.zoneTop", bottom: "layout.panelBottom",
};

/** État du geste uniquement : déplacer la souris ne modifie pas les préférences. */
export const useApercuPlacementModule = create<{
  saisie: { id: PanneauId; x: number; y: number } | null;
  cible: PlacementModule | null;
  saisir: (id: PanneauId, x: number, y: number) => void;
  suivre: (x: number, y: number) => void;
  liberer: () => void;
  viser: (cible: PlacementModule | null) => void;
}>((set) => ({
  saisie: null,
  cible: null,
  saisir: (id, x, y) => set({ saisie: { id, x, y }, cible: null }),
  suivre: (x, y) => set((s) => s.saisie ? { saisie: { ...s.saisie, x, y } } : s),
  liberer: () => set({ saisie: null, cible: null }),
  viser: (cible) => set((s) => s.cible?.zone === cible?.zone && s.cible?.avant === cible?.avant ? s : { cible }),
}));

/** Les quatre bords restent des destinations, sans cadres permanents. */
export function placementSousPointeur(source: HTMLElement, id: PanneauId, x: number, y: number): PlacementModule | null {
  const racine = source.closest<HTMLElement>(".sion-main-area");
  if (!racine) return null;
  const rect = racine.getBoundingClientRect();
  if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
  const calques = document.elementsFromPoint(x, y).filter((e) => !e.closest(".sion-apercu-deplacement, .sion-module-en-main"));
  const colonne = calques.map((e) => e.closest<HTMLElement>("[data-zone-panneaux]"))
    .find((e) => e && racine.contains(e));
  let zone = colonne?.dataset.zonePanneaux as ZonePanneau | undefined;
  if (!zone) {
    if (y >= rect.bottom - rect.height * .26) zone = "bottom";
    else if (y < rect.top + rect.height * .26) zone = "top";
    else if (x < rect.left + rect.width * .24) zone = "left";
    else if (x >= rect.right - rect.width * .24) zone = "right";
    else return null;
  }
  const surSoi = calques.some((e) => e.closest<HTMLElement>("[data-panneau]")?.dataset.panneau === id);
  if (surSoi && (useLayoutStore.getState().positionsPanneaux[id] ?? "right") === zone) return { zone, avant: id };
  const cartes = racine.querySelectorAll<HTMLElement>(`[data-zone-panneaux="${zone}"] [data-panneau]`);
  for (const carte of cartes) {
    if (carte.dataset.panneau === id) continue;
    const r = carte.getBoundingClientRect();
    if (zone === "bottom" || zone === "top" ? x < r.left + r.width / 2 : y < r.top + r.height / 2) {
      return { zone, avant: carte.dataset.panneau as PanneauId };
    }
  }
  return { zone };
}

export function ordreApresPlacement(panneaux: PanneauId[], id: PanneauId, cible: PlacementModule): PanneauId[] {
  if (cible.avant === id) return panneaux;
  const ordre = panneaux.filter((p) => p !== id);
  const index = cible.avant ? ordre.indexOf(cible.avant) : -1;
  ordre.splice(index < 0 ? ordre.length : index, 0, id);
  return ordre;
}
