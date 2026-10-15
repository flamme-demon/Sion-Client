import * as core from "./matrixCore";
import { moteurRust } from "./moteur";
import { administrateurEspace, espaceSelectionne, lireEtat } from "./espacesService";
import { banUser, getMatrixClient, inviteUser, kickUser, unbanUser } from "./matrixService";
import { useMatrixStore } from "../stores/useMatrixStore";

export interface MembreBibliotheque {
  userId: string;
  displayName: string;
  powerLevel: number;
  banni?: boolean;
  peutExpulser?: boolean;
  peutBannir?: boolean;
  peutRetablir?: boolean;
}
export interface AccesBibliotheque {
  salon: string | null;
  administrateur: boolean;
  peutInviter: boolean;
  membres: MembreBibliotheque[];
  invitations: MembreBibliotheque[];
  manquants: MembreBibliotheque[];
  exclus: MembreBibliotheque[];
}
type EtatMembre = { stateKey: string; content: Record<string, unknown>; sender?: string };
const verifierCompte = (compte: string | null) => {
  if (!compte || useMatrixStore.getState().currentUserId !== compte) throw new Error("spaces.libraryChanged");
};
const niveau = (valeur: unknown, defaut = 0) => typeof valeur === "number" && Number.isFinite(valeur)
  ? valeur >= Number.MAX_SAFE_INTEGER ? Infinity : valeur : defaut;
const trier = (membres: MembreBibliotheque[]) => membres.sort((a, b) =>
  a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }) || a.userId.localeCompare(b.userId));

async function salonBibliotheque(espace: string): Promise<string | null> {
  const etat = await lireEtat(espace, "com.sion.space");
  const id = etat === undefined ? espaceSelectionne(espace)?.boardRoomId : etat.board_room_id;
  if (!id) return null;
  if (typeof id !== "string" || !id.startsWith("!") || id === espace) throw new Error("spaces.libraryUnavailable");
  return id;
}

async function membresComplets(salon: string) {
  if (moteurRust()) {
    // Include lazy-loaded members and changes acknowledged before /sync.
    const details = await core.detailsSalon(salon, true);
    return { moi: details.moi, adhesions: details.adhesions, membres: details.membres.map((m) => ({ userId: m.userId,
      displayName: m.displayName || m.userId, powerLevel: m.powerLevel })) };
  }
  const client = getMatrixClient();
  const room = client?.getRoom(salon);
  if (!client || !room) throw new Error("spaces.libraryUnavailable");
  await room.loadMembersIfNeeded();
  const reponse = await client.members(salon);
  const adhesions: EtatMembre[] = reponse.chunk.map((e) => ({ stateKey: e.state_key, content: e.content, sender: e.sender }));
  return { moi: room.getMember(client.getUserId() ?? "")?.powerLevel ?? 0,
    adhesions, membres: adhesions.filter((e) => e.content.membership === "join").map((e) => ({ userId: e.stateKey,
      displayName: typeof e.content.displayname === "string" && e.content.displayname.trim() ? e.content.displayname : e.stateKey,
      powerLevel: room.getMember(e.stateKey)?.powerLevel ?? 0 })) };
}

async function etatsMembres(salon: string): Promise<EtatMembre[]> {
  if (moteurRust()) return core.etats(salon, "m.room.member");
  const room = getMatrixClient()?.getRoom(salon);
  if (!room) throw new Error("spaces.libraryUnavailable");
  return room.currentState.getStateEvents("m.room.member").map((e) => ({
    stateKey: e.getStateKey() ?? "", content: e.getContent(), sender: e.getSender(),
  }));
}

export async function chargerBibliothequeEspace(espace: string): Promise<AccesBibliotheque> {
  const compte = useMatrixStore.getState().currentUserId;
  const [salon, administrateur, equipe] = await Promise.all([
    salonBibliotheque(espace), administrateurEspace(espace), membresComplets(espace),
  ]);
  verifierCompte(compte);
  if (!salon) return { salon, administrateur, peutInviter: false, membres: [], invitations: [], manquants: [], exclus: [] };
  const salle = await membresComplets(salon);
  const [etats, pouvoirs] = await Promise.all([salle.adhesions ?? etatsMembres(salon), lireEtat(salon, "m.room.power_levels")]);
  verifierCompte(compte);
  const inscrit = salle.membres.some((m) => m.userId === compte);
  const peutInviter = administrateur && inscrit && salle.moi >= niveau(pouvoirs?.invite);
  const seuilExpulsion = niveau(pouvoirs?.kick, 50), seuilBannissement = niveau(pouvoirs?.ban, 50);
  const utilisateurs = pouvoirs?.users as Record<string, unknown> | undefined;
  const profils = new Map(equipe.membres.map((m) => [m.userId, m]));
  const statut = new Map(etats.map((e) => [e.stateKey, e]));
  const presents = new Set(salle.membres.map((m) => m.userId));
  const membre = (e: EtatMembre): MembreBibliotheque => ({ userId: e.stateKey,
    displayName: typeof e.content.displayname === "string" && e.content.displayname.trim()
      ? e.content.displayname.trim() : profils.get(e.stateKey)?.displayName ?? e.stateKey,
    powerLevel: niveau(utilisateurs?.[e.stateKey], niveau(pouvoirs?.users_default)),
  });
  const moderable = (m: MembreBibliotheque, seuil: number) => inscrit && m.userId !== compte && salle.moi >= seuil && salle.moi > m.powerLevel;
  const invitations = etats.filter((e) => e.content.membership === "invite" && !presents.has(e.stateKey)).map(membre);
  const exclus = etats.filter((e) => e.content.membership === "ban" ||
    (e.content.membership === "leave" && e.sender && e.sender !== e.stateKey)).map((e) => {
    const m = membre(e), banni = e.content.membership === "ban";
    return { ...m, banni, peutRetablir: peutInviter && (!banni || moderable(m, Math.max(seuilExpulsion, seuilBannissement))) };
  });
  const exclusIds = new Set(exclus.map((m) => m.userId));
  const manquants = equipe.membres.filter((m) => !presents.has(m.userId) && !exclusIds.has(m.userId) &&
    !["join", "invite", "ban"].includes(String(statut.get(m.userId)?.content.membership ?? "")));
  return { salon, administrateur, peutInviter, membres: trier(salle.membres.map((m) => ({ ...m,
    peutExpulser: moderable(m, seuilExpulsion), peutBannir: moderable(m, seuilBannissement) }))),
    invitations: trier(invitations), manquants: trier(manquants), exclus: trier(exclus) };
}

async function verifierBibliotheque(espace: string, salon: string, compte: string | null) {
  const acces = await chargerBibliothequeEspace(espace);
  verifierCompte(compte);
  if (acces.salon !== salon) throw new Error("spaces.libraryChanged");
  return acces;
}

export async function inviterBibliothequeEspace(espace: string, salon: string, utilisateur?: string) {
  const compte = useMatrixStore.getState().currentUserId;
  const acces = await verifierBibliotheque(espace, salon, compte);
  if (!acces.peutInviter) throw new Error("spaces.permissionDenied");
  const cibles = acces.manquants.filter((m) => !utilisateur || m.userId === utilisateur);
  if (utilisateur && !cibles.length) throw new Error("spaces.libraryChanged");
  const echecs: string[] = [];
  let invitedCount = 0;
  for (const membre of cibles) {
    verifierCompte(compte);
    try { await inviteUser(salon, membre.userId); invitedCount++; }
    catch { echecs.push(membre.userId); }
  }
  return { echecs, invitedCount };
}

export async function modererBibliothequeEspace(espace: string, salon: string, utilisateur: string,
  action: "expulser" | "bannir" | "retablir", raison?: string) {
  const compte = useMatrixStore.getState().currentUserId;
  const acces = await verifierBibliotheque(espace, salon, compte);
  const cible = (action === "retablir" ? acces.exclus : acces.membres).find((m) => m.userId === utilisateur);
  const autorise = action === "retablir" ? cible?.peutRetablir : action === "bannir" ? cible?.peutBannir : cible?.peutExpulser;
  if (!autorise) throw new Error("spaces.permissionDenied");
  verifierCompte(compte);
  if (action === "expulser") await kickUser(salon, utilisateur, raison?.trim() || undefined);
  else if (action === "bannir") await banUser(salon, utilisateur, raison?.trim() || undefined);
  else {
    if (cible?.banni) await unbanUser(salon, utilisateur);
    verifierCompte(compte);
    await inviteUser(salon, utilisateur);
  }
}
