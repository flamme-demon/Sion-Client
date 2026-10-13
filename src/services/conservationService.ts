import * as core from "./matrixCore";
import { moteurRust } from "./moteur";
import { getMatrixClient } from "./matrixService";
import { useMatrixStore } from "../stores/useMatrixStore";

export const CHEMIN_CONSERVATION = "/_continuwuity/sion/conservation/v1";
export type PolitiqueConservation = { mode: "unlimited" } | { mode: "days"; days: number } | { mode: "inherit"; parent: string };
export interface SalonConservation {
  id: string;
  name: string;
  isSpace: boolean;
  policy: PolitiqueConservation;
  effectiveDays: number | null;
  parentId: string | null;
  parentName: string | null;
  editable: boolean;
  protected: boolean;
}
export interface VueConservation {
  available: boolean;
  applying: boolean;
  lastRun: number | null;
  lastFailed?: boolean;
  scope: SalonConservation;
  rooms: SalonConservation[];
}
export interface ModificationConservation { roomId: string; policy: PolitiqueConservation }
export interface ApercuConservation {
  revision: string;
  expiresAt: number;
  messages: number;
  files: number;
  protectedFiles: number;
  uncertainFiles: number;
  blockedMessages: number;
}

export function joursConservation(politique: PolitiqueConservation, defaut: number | null = null): number | null {
  return politique.mode === "days" ? politique.days : politique.mode === "inherit" ? defaut : null;
}
export function politiqueValide(p: PolitiqueConservation): boolean {
  return p.mode === "unlimited" || (p.mode === "inherit" && /^![^\s]+$/.test(p.parent))
    || (p.mode === "days" && Number.isSafeInteger(p.days) && p.days >= 1 && p.days <= 36500);
}
function validerModifications(modifications: ModificationConservation[]) {
  if (!modifications.length || modifications.length > 100 || new Set(modifications.map((m) => m.roomId)).size !== modifications.length
    || modifications.some((m) => !politiqueValide(m.policy))) throw new Error("conservation.invalidPolicy");
}

async function requete<T>(corps: Record<string, unknown>): Promise<T> {
  const utilisateur = useMatrixStore.getState().currentUserId;
  if (!utilisateur) throw new Error("conservation.accountChanged");
  let reponse: T;
  if (moteurRust()) {
    reponse = await core.requeteAdmin<T>(CHEMIN_CONSERVATION, { methode: "POST", corps, authentifiee: true });
  } else {
    const client = getMatrixClient();
    if (!client) throw new Error("conservation.accountChanged");
    // Le chemin reste sur le homeserver connecté. Le jeton natif ne passe
    // jamais par cette branche, ni par le JavaScript.
    const resultat = await fetch(`${client.getHomeserverUrl().replace(/\/$/, "")}${CHEMIN_CONSERVATION}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${client.getAccessToken()}` },
      body: JSON.stringify(corps), signal: AbortSignal.timeout(30000),
    });
    if (!resultat.ok) {
      const erreur = await resultat.json().catch(() => ({}));
      throw new core.ErreurApiAdmin(resultat.status, erreur.errcode);
    }
    reponse = await resultat.json();
  }
  if (useMatrixStore.getState().currentUserId !== utilisateur) throw new Error("conservation.accountChanged");
  return reponse;
}

export async function lireConservation(scopeId: string): Promise<VueConservation> {
  try { return await requete<VueConservation>({ action: "read", scopeId }); }
  catch (e) {
    // Un chemin absent peut être rejeté avec un 403 vide par le homeserver.
    // Les refus Matrix structurés et les pannes restent visibles.
    if (!(e instanceof core.ErreurApiAdmin) || e.errcode === "M_NOT_FOUND"
      || !([404, 405, 501].includes(e.status) || (e.status === 403 && !e.errcode))) throw e;
    const channels = useMatrixStore.getState().channels;
    const scope = channels.find((c) => c.id === scopeId);
    if (!scope) throw new Error("conservation.loadFailed", { cause: e });
    const salon = (c: typeof scope): SalonConservation => ({ id: c.id, name: c.name, isSpace: !!c.isSpace,
      policy: { mode: "unlimited" }, effectiveDays: null, parentId: null, parentName: null, editable: false,
      protected: !!c.isSoundboard || channels.some((s) => s.boardRoomId === c.id),
    });
    return { available: false, applying: false, lastRun: null, scope: salon(scope),
      rooms: scope.isSpace ? channels.filter((c) => scope.spaceChildren?.includes(c.id) && !c.isSpace).map(salon) : [] };
  }
}
export async function apercuConservation(scopeId: string, changes: ModificationConservation[]): Promise<ApercuConservation> {
  validerModifications(changes);
  return requete({ action: "preview", scopeId, changes });
}
export async function enregistrerConservation(scopeId: string, changes: ModificationConservation[], revision: string): Promise<VueConservation> {
  validerModifications(changes);
  if (!revision) throw new Error("conservation.previewRequired");
  return requete({ action: "save", scopeId, changes, revision });
}
