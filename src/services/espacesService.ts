import * as sdk from "matrix-js-sdk";
import * as core from "./matrixCore";
import { moteurRust } from "./moteur";
import { getMatrixClient, inviteUser, leaveRoom, setRoomAvatar, setRoomName, setRoomTopic } from "./matrixService";
import { useEspacesStore } from "../stores/useEspacesStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { adresseEspace, salonCommun } from "../utils/espaces";
import type { Channel } from "../types/matrix";

export const espaceSelectionne = (id = useEspacesStore.getState().espaceActif): Channel | undefined => {
  return useMatrixStore.getState().channels.find((c) => c.isSpace && c.id === id);
};
function client() {
  const c = getMatrixClient();
  if (!c) throw new Error("Matrix client not initialized");
  return c;
}
export async function lireEtat(salon: string, type: string, cle = ""): Promise<Record<string, unknown> | undefined> {
  if (moteurRust()) return (await core.etats(salon, type)).find((e) => e.stateKey === cle)?.content;
  // Custom events are valid Matrix state events.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client().getRoom(salon)?.currentState.getStateEvents(type as any, cle)?.getContent();
}
export async function envoyerEtat(salon: string, type: string, contenu: Record<string, unknown>, cle = "") {
  if (moteurRust()) return core.envoyerEtat(salon, type, cle, contenu);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client().sendStateEvent(salon, type as any, contenu, cle);
}
export async function responsables(espace: string): Promise<boolean> {
  if (moteurRust()) { const d = await core.detailsSalon(espace); return d.moi >= d.niveauEtat; }
  const c = client();
  return c.getRoom(espace)?.currentState.maySendStateEvent("m.space.child", c.getUserId()!) ?? false;
}
export async function verifierResponsable(espace: string) {
  if (!await responsables(espace)) throw new Error("spaces.permissionDenied");
}
export async function administrateurEspace(espace: string): Promise<boolean> {
  if (moteurRust()) return (await core.detailsSalon(espace)).moi >= 100;
  const c = client();
  const moi = c.getUserId();
  return !!moi && (c.getRoom(espace)?.getMember(moi)?.powerLevel ?? 0) >= 100;
}
export function serveursVia(salon: string): string[] {
  const ch = useMatrixStore.getState().channels.find((c) => c.id === salon);
  const candidats = [useMatrixStore.getState().currentUserId, ...(ch?.voiceUsers ?? []).map((u) => u.id)];
  const domaines = candidats.filter((id): id is string => !!id).map((id) => id.slice(id.indexOf(":") + 1));
  return [...new Set(domaines)].slice(0, 3);
}
export function lienEspace(espace: string, via = serveursVia(espace)) {
  const query = new URLSearchParams(); via.forEach((s) => query.append("via", s));
  return `https://matrix.to/#/${encodeURIComponent(espace)}${query.size ? `?${query}` : ""}`;
}
export interface SalonHierarchie {
  room_id: string; name?: string; topic?: string; avatar_url?: string; room_type?: string;
  join_rule?: string; allowed_room_ids?: string[];
  children_state?: { type: string; state_key: string; content: { via?: string[]; suggested?: boolean } }[];
}
export async function hierarchieEspace(espace: string): Promise<SalonHierarchie[]> {
  const rooms = new Map<string, SalonHierarchie>();
  const pages = new Set<string>();
  let suivant: string | undefined;
  do {
    const r = moteurRust()
      ? await core.hierarchieEspace(espace, suivant)
      : await client().getRoomHierarchy(espace, 100, 1, false, suivant);
    for (const room of r.rooms) rooms.set(room.room_id, room);
    suivant = r.next_batch;
    if (suivant && pages.has(suivant)) throw new Error("spaces.hierarchyIncomplete");
    if (suivant) pages.add(suivant);
  } while (suivant);
  return [...rooms.values()];
}
export async function rejoindreAvecVia(adresse: string, via: string[]) {
  const utilisateur = useMatrixStore.getState().currentUserId;
  const id = moteurRust() ? await core.rejoindreAvecVia(adresse, via)
    : (await client().joinRoom(adresse, { viaServers: via })).roomId;
  if (useMatrixStore.getState().currentUserId === utilisateur) useEspacesStore.getState().oublierSalonQuitte(id);
  return id;
}
export async function rejoindreSalonsCommuns(espace: string, respecterDeparts = true): Promise<string[]> {
  const utilisateur = useMatrixStore.getState().currentUserId;
  const rooms = await hierarchieEspace(espace);
  const racine = rooms.find((r) => r.room_id === espace);
  const liens = (racine?.children_state ?? []).filter((e) => e.type === "m.space.child" && e.content.via?.length);
  const echecs: string[] = [];
  for (const lien of liens) {
    if (useMatrixStore.getState().currentUserId !== utilisateur) break;
    const room = rooms.find((r) => r.room_id === lien.state_key);
    if (!room || room.room_type === "m.space") continue;
    if (respecterDeparts && useEspacesStore.getState().salonsQuittes.includes(room.room_id)) continue;
    if (!(room.join_rule === "public" || (["restricted", "knock_restricted"].includes(room.join_rule ?? "") && room.allowed_room_ids?.includes(espace)))) continue;
    if (useMatrixStore.getState().channels.some((c) => c.id === room.room_id && c.membership !== "invite")) continue;
    try { await rejoindreAvecVia(room.room_id, lien.content.via!); } catch { echecs.push(room.name ?? room.room_id); }
  }
  return echecs;
}
export async function rejoindreEspace(entree: string) {
  const { adresse, via } = adresseEspace(entree);
  let id: string;
  if (moteurRust()) id = await core.rejoindreEspace(adresse, via);
  else {
    const rejoints = new Set(client().getRooms().filter((r) => r.getMyMembership() === "join").map((r) => r.roomId));
    id = await rejoindreAvecVia(adresse, via);
    const creation = await client().getStateEvent(id, "m.room.create", "");
    if (creation.type !== "m.space") {
      if (!rejoints.has(id)) await leaveRoom(id);
      throw new Error("spaces.notSpace");
    }
  }
  useEspacesStore.getState().choisir(id);
  return { id, echecs: await rejoindreSalonsCommuns(id) };
}
export async function creerEspace(nom: string, sujet: string, publique: boolean): Promise<string> {
  if (!nom.trim()) throw new Error("spaces.nameRequired");
  const id = moteurRust() ? await core.creerEspace(nom.trim(), sujet, publique)
    : (await client().createRoom({ name: nom.trim(), topic: sujet, creation_content: { type: "m.space" },
      preset: publique ? sdk.Preset.PublicChat : sdk.Preset.PrivateChat,
      power_level_content_override: { users: { [client().getUserId()!]: 100 }, events_default: 100, state_default: 50, invite: 50 },
    })).room_id;
  useEspacesStore.getState().choisir(id);
  return id;
}
export async function lierSalon(espace: string, salon: string, commun: boolean) {
  await verifierResponsable(espace);
  let regle = await lireEtat(salon, "m.room.join_rules");
  // Un salon tout neuf peut précéder son état dans /sync.
  const debut = Date.now();
  while (!regle && Date.now() - debut < 20000) {
    await new Promise((r) => setTimeout(r, 150));
    regle = await lireEtat(salon, "m.room.join_rules");
  }
  if (commun && !salonCommun(regle, espace)) throw new Error("spaces.privateRoom");
  // Un salon public rattaché à une équipe devient accessible aux membres de celle-ci.
  if (commun && regle?.join_rule === "public") await envoyerEtat(salon, "m.room.join_rules", { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: espace }] });
  const via = serveursVia(salon);
  await envoyerEtat(salon, "m.space.parent", { via, canonical: true }, espace);
  await envoyerEtat(espace, "m.space.child", { via, suggested: commun }, salon);
}
export async function retirerSalon(espace: string, salon: string) {
  await verifierResponsable(espace);
  const regle = await lireEtat(salon, "m.room.join_rules");
  if (Array.isArray(regle?.allow) && salonCommun(regle, espace) && regle.join_rule !== "public") {
    const allow = regle.allow.filter((a) => !(a?.type === "m.room_membership" && a.room_id === espace));
    await envoyerEtat(salon, "m.room.join_rules", allow.length ? { ...regle, allow } : { join_rule: "invite" });
  }
  await envoyerEtat(salon, "m.space.parent", {}, espace);
  await envoyerEtat(espace, "m.space.child", {}, salon);
}
export async function creerSalonDansEspace(espace: string, nom: string, vocal: boolean, commun: boolean, chiffre = false, bibliotheque = false, inviter = true) {
  await verifierResponsable(espace);
  const id = moteurRust() ? await core.creerSalon(nom, vocal, commun, chiffre, espace, bibliotheque)
    : (await client().createRoom({ name: nom, preset: sdk.Preset.PrivateChat,
      initial_state: [
        { type: "m.room.join_rules", state_key: "", content: commun ? { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: espace }] } : { join_rule: "invite" } },
        { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "shared" } },
        ...(vocal || bibliotheque ? [{ type: "m.room.type", state_key: "", content: { type: bibliotheque ? "com.sion.board" : "m.voice_channel" } }] : []),
        ...(chiffre ? [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }] : []),
      ], power_level_content_override: { users: Object.fromEntries((await membresEspace(espace)).filter((m) => m.powerLevel >= 50).map((m) => [m.userId, Math.min(m.powerLevel, 100)]).concat([[client().getUserId()!, 100]])), events_default: bibliotheque ? 50 : 0, state_default: 50, invite: 50,
        events: { "org.matrix.msc3401.call.member": 0, "com.sion.version": 0 } },
    })).room_id;
  await lierSalon(espace, id, commun);
  if (commun && inviter) await inviterMembresEspace(espace, id);
  return id;
}
export async function membresEspace(espace: string): Promise<{ userId: string; displayName?: string; powerLevel: number }[]> {
  if (moteurRust()) return (await core.detailsSalon(espace)).membres;
  const room = client().getRoom(espace);
  if (!room) throw new Error("spaces.notSpace");
  await room.loadMembersIfNeeded();
  return room.getJoinedMembers().map((m) => ({ userId: m.userId, displayName: m.name, powerLevel: m.powerLevel }));
}
export async function inviterMembresEspace(espace: string, salon: string): Promise<string[]> {
  const echecs: string[] = [];
  for (const m of await membresEspace(espace)) {
    if (m.userId === useMatrixStore.getState().currentUserId) continue;
    try { await inviteUser(salon, m.userId); } catch (e) {
      // Déjà membre : une invitation inutile ne devient pas un échec.
      const membres = moteurRust() ? (await core.detailsSalon(salon)).membres : client().getRoom(salon)?.getJoinedMembers();
      if (!membres?.some((u) => u.userId === m.userId)) { console.warn("[Sion][espaces] invitation échouée", e); echecs.push(m.userId); }
    }
  }
  return echecs;
}
export async function rattacherBibliotheque(espace: string, salon: string) {
  if (!await administrateurEspace(espace)) throw new Error("spaces.libraryAdminOnly");
  await lierSalon(espace, salon, true);
  await envoyerEtat(espace, "com.sion.space", { board_room_id: salon });
  await inviterMembresEspace(espace, salon);
}
export async function creerBibliotheque(espace: string) {
  if (!await administrateurEspace(espace)) throw new Error("spaces.libraryAdminOnly");
  const ancien = String((await lireEtat(espace, "com.sion.space"))?.board_room_id ?? "");
  if (ancien) { const echecs = await inviterMembresEspace(espace, ancien); return { roomId: ancien, alreadyExisted: true, invitedCount: (await membresEspace(espace)).length - echecs.length, echecs }; }
  const id = await creerSalonDansEspace(espace, "Soundboard & Memeboard", false, true, false, true, false);
  await envoyerEtat(espace, "com.sion.space", { board_room_id: id });
  const echecs = await inviterMembresEspace(espace, id);
  return { roomId: id, alreadyExisted: false, invitedCount: 0, echecs };
}
export async function modifierEspace(espace: string, nom: string, sujet: string, image?: File) {
  await verifierResponsable(espace);
  await setRoomName(espace, nom); await setRoomTopic(espace, sujet);
  if (image) await setRoomAvatar(espace, image);
}

/** Matrix n'hérite pas des rôles du parent : synchroniser aussi les salons communs connus. */
export async function changerRoleEspace(espace: string, user: string, niveau: number) {
  const { setUserPowerLevel } = await import("./matrixService");
  await verifierResponsable(espace);
  const salles = await hierarchieEspace(espace);
  await setUserPowerLevel(espace, user, niveau);
  const echecs: string[] = [];
  for (const salle of salles) {
    if (salle.room_id === espace || salle.room_type === "m.space") continue;
    if (!(salle.join_rule === "public" || (salle.join_rule === "restricted" && salle.allowed_room_ids?.includes(espace)))) continue;
    try { await setUserPowerLevel(salle.room_id, user, niveau); } catch { echecs.push(salle.room_id); }
  }
  return echecs;
}
