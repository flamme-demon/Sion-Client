import { useAppStore } from "../stores/useAppStore";
import { useEspacesStore } from "../stores/useEspacesStore";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { choisirEspace } from "../hooks/useEspaces";
import { planDepartEspace } from "../utils/departEspace";
import { contexteBibliotheque } from "../utils/bibliotheque";
import { quitterSalon } from "./quitterSalon";
import { arreterReconnexion } from "./reconnexionVocale";
import type { Channel } from "../types/matrix";

export class EchecDepartEspace extends Error {
  salons: Channel[];
  espace: boolean;
  constructor(salons: Channel[], espace = false) {
    super(espace ? "spaces.leaveSpaceFailed" : "spaces.leaveRoomsFailed");
    this.salons = salons;
    this.espace = espace;
  }
}

/** Ne quitter que les adhésions présentées et choisies dans la confirmation.
 * L'espace reste rejoint tant qu'un départ de salon a échoué. */
export async function quitterEspace(espaceId: string, selection: string[],
  quitterVocal: (salonId: string) => Promise<void>, partagesAutorises: string[] = []) {
  const utilisateur = useMatrixStore.getState().currentUserId;
  const memeCompte = () => useMatrixStore.getState().currentUserId === utilisateur;
  if (!utilisateur) throw new Error("spaces.leaveSpaceFailed");
  const espace = useMatrixStore.getState().channels.find((c) => c.id === espaceId && c.isSpace && c.membership !== "invite");
  if (!espace) throw new Error("spaces.leaveSpaceFailed");
  const plan = () => planDepartEspace(useMatrixStore.getState().channels, espaceId, useEspacesStore.getState().hierarchies);
  const choisis = new Set(selection);
  const partages = new Set(partagesAutorises);
  const vocal = useAppStore.getState().connectedVoiceChannel;
  if (vocal && !choisis.has(vocal)) {
    const etat = useEspacesStore.getState();
    const contexte = contexteBibliotheque(useMatrixStore.getState().channels, etat.espaceActif, vocal,
      etat.hierarchies, etat.espaceVocalConserve);
    const parent = useMatrixStore.getState().channels.find((c) => c.id === contexte.espaceId);
    if (parent?.boardRoomId && !choisis.has(parent.boardRoomId) && (parent.id === espaceId || choisis.has(parent.id))) {
      useEspacesStore.setState({ espaceVocalConserve: { vocal,
        espace: { ...parent, spaceChildren: [...new Set([...(parent.spaceChildren ?? []), vocal])], voiceUsers: [] } } });
    }
  }
  const echecs: Channel[] = [];
  for (const { salon } of plan().filter((p) => choisis.has(p.salon.id))) {
    if (!memeCompte()) return;
    // Une nouvelle relation apparue pendant le départ ne doit pas faire
    // quitter silencieusement un salon d'une autre communauté.
    const actuel = plan().find((p) => p.salon.id === salon.id);
    if (!actuel || (actuel.partageAvec.length && !partages.has(salon.id))) continue;
    const app = useAppStore.getState();
    if (app.pendingAutoJoinVoice === salon.id) app.setPendingAutoJoinVoice(null);
    if (app.reconnexionVocale?.salon === salon.id) arreterReconnexion();
    try {
      if (app.connectingVoiceChannel === salon.id) {
        const { attendreConnexionsVocales } = await import("../hooks/useVoiceChannel");
        await attendreConnexionsVocales();
      }
      if (!memeCompte()) return;
      if (useAppStore.getState().connectedVoiceChannel === salon.id) await quitterVocal(salon.id);
      if (!memeCompte()) return;
      await quitterSalon(salon);
      if (!memeCompte()) return;
      if (useSettingsStore.getState().defaultChannel === salon.id) {
        useSettingsStore.getState().setDefaultChannel("");
        useSettingsStore.getState().setAutoJoinVoice(false);
      }
    } catch { if (memeCompte()) echecs.push(salon); }
  }
  if (!memeCompte()) return;
  if (echecs.length) throw new EchecDepartEspace(echecs);
  try { await quitterSalon(espace); }
  catch { if (memeCompte()) throw new EchecDepartEspace([], true); }
  if (!memeCompte()) return;
  const etat = useEspacesStore.getState();
  const derniersSalons = { ...etat.derniersSalons };
  const hierarchies = { ...etat.hierarchies };
  delete derniersSalons[espaceId];
  delete hierarchies[espaceId];
  useEspacesStore.setState({ derniersSalons, hierarchies });
  if (etat.espaceActif === espaceId) {
    choisirEspace(null);
    useEspacesStore.getState().ouvrir(null);
  }
}
