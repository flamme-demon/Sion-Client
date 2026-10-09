import { useEspacesStore } from "../../stores/useEspacesStore";
import { salonsDansEspace } from "../../utils/espaces";
import { useCompteurPanneau } from "../layout/panneauxCompteurs";
import { useEffect, useState, useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { UserEvent } from "matrix-js-sdk";
import type { MatrixPresence } from "../../types/matrix";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useLiveKitStore } from "../../stores/useLiveKitStore";
import { HeadphoneIcon } from "../icons";
import { getMatrixClient, getMemberPowerLevel } from "../../services/matrixService";
import { UserAvatar } from "../sidebar/UserAvatar";
import * as cacheRust from "../../services/cacheRust";
import { moteurRust } from "../../services/moteur";
import { getRoomMembers } from "../../services/matrixService";
import { gestesMenuContextuel, STYLE_SANS_SELECTION } from "../../utils/menuContextuel";
import "./MemberPanel.css";

type Role = "admin" | "moderator" | "user";
type Group = "voice" | "online" | "afk" | "offline";
const GROUP_LABELS: Record<Group, string> = { voice: "En vocal", online: "En ligne", afk: "AFK", offline: "Hors ligne" };

interface Entry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  pl: number;
  presence?: MatrixPresence;
}

function plToRole(pl: number): Role {
  if (pl >= 100) return "admin";
  if (pl >= 50) return "moderator";
  return "user";
}

/**
 * Liste des membres du salon courant ; le titre et la fermeture sont portés
 * par le panneau latéral ou la feuille mobile.
 */
export function MemberPanel() {
  const { t, i18n } = useTranslation();
  const activeChannel = useAppStore((s) => s.activeChannel);
  const openUserContextMenu = useAppStore((s) => s.openUserContextMenu);
  const channels = useMatrixStore((s) => s.channels);
  const channel = channels.find((c) => c.id === activeChannel);
  const espaceActif = useEspacesStore((s) => s.espaceActif);
  const salonMembres = channel?.isDM ? activeChannel : espaceActif ?? activeChannel;
  const [tick, setTick] = useState(0);
  // Moteur Rust : une réponse du cœur arrivée dans le cache fait redessiner.
  const versionCache = useMatrixStore((s) => s.pinnedVersion);
  const connected = useMatrixStore((s) => s.connectionStatus === "connected");
  const voiceConnected = useLiveKitStore((s) => s.connected);
  const participants = useLiveKitStore((s) => s.participants);
  const connectedVoiceChannel = useAppStore((s) => s.connectedVoiceChannel);

  // Les fichiers publics changent en dev, mais i18next conserve le dictionnaire
  // déjà chargé. Relire les ressources si cette session ignore les nouveaux titres.
  useEffect(() => {
    if (i18n.exists("members.groups.online")) return;
    let actif = true;
    void i18n.reloadResources().then(() => { if (actif) setTick((n) => n + 1); }).catch(() => {});
    return () => { actif = false; };
  }, [i18n]);

  // Les appels visibles dans tous les salons, même sans les rejoindre.
  const voiceMembers = useMemo(() => {
    const appareils = new Map<string, { sourdines: boolean[]; salons: Map<string, string> }>();
    for (const c of (espaceActif ? salonsDansEspace(channels, espaceActif) : channels).filter((c) => c.hasVoice)) {
      for (const u of c.voiceUsers) {
        const sourdines = u.devices?.length ? u.devices.map((d) => d.deafened) : [u.deafened];
        const vocal = appareils.get(u.id) ?? { sourdines: [], salons: new Map<string, string>() };
        vocal.sourdines.push(...sourdines);
        vocal.salons.set(c.id, c.name);
        appareils.set(u.id, vocal);
      }
    }
    // Un téléphone encore à l'écoute évite de classer le compte AFK
    // seulement parce que le PC est en sourdine.
    return new Map([...appareils].map(([id, vocal]) => [id, {
      group: vocal.sourdines.every(Boolean) ? "afk" as const : "voice" as const,
      salons: vocal.salons,
    }]));
  }, [channels, espaceActif]);

  // Refresh list on Matrix state events (member joins/leaves, power level changes)
  useEffect(() => {
    if (!salonMembres) return;
    if (moteurRust()) {
      // Pas d'événements de salon ici : les membres sont redemandés au cœur
      // tant que le panneau est ouvert (l'arrivée fait redessiner).
      cacheRust.oublierDetails(salonMembres);
      const minuterie = setInterval(() => cacheRust.oublierDetails(salonMembres), 15_000);
      return () => clearInterval(minuterie);
    }
    const client = getMatrixClient();
    if (!client) return;
    const room = client.getRoom(salonMembres);
    if (!room) return;
    const bump = () => setTick((n) => n + 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = room as any;
    r.on("RoomMember.membership", bump);
    r.on("RoomMember.powerLevel", bump);
    r.on("RoomState.events", bump);
    client.on(UserEvent.Presence, bump);
    return () => {
      r.off("RoomMember.membership", bump);
      r.off("RoomMember.powerLevel", bump);
      r.off("RoomState.events", bump);
      client.off(UserEvent.Presence, bump);
    };
  }, [salonMembres]);

  const entries = useMemo<Entry[]>(() => {
    void tick;
    void versionCache;
    if (!salonMembres) return [];
    return getRoomMembers(salonMembres)
      .map((m) => {
        const pl = getMemberPowerLevel(salonMembres, m.userId);
        return { ...m, role: plToRole(pl), pl };
      })
      .sort((a, b) => (a.pl !== b.pl ? b.pl - a.pl : a.displayName.localeCompare(b.displayName)));
  }, [salonMembres, tick, versionCache]);

  useCompteurPanneau("members", entries.length);

  if (!activeChannel || channel?.isDM) return null;

  const groupOf = (e: Entry): Group => {
    const vocal = connected ? voiceMembers.get(e.userId) : undefined;
    if (vocal) return vocal.group;
    // « unavailable » reste connecté à Matrix ; AFK désigne la sourdine
    // d'un membre en vocal, et non l'inactivité de son compte Matrix.
    if (connected && (e.presence === "online" || e.presence === "unavailable")) return "online";
    return "offline";
  };
  const sections = (["voice", "online", "afk", "offline"] as const)
    .map((group) => ({ group, entries: entries.filter((e) => groupOf(e) === group) }));
  const groupLabel = (group: Group) => t(`members.groups.${group}`, { defaultValue: GROUP_LABELS[group] });

  return (
    <div className="sion-membres">
      <div className="sion-membres-groupes" style={{
        "--sion-membres-colonnes": sections.map((sec) => sec.entries.length
          ? `minmax(170px, ${Math.min(4, sec.entries.length)}fr)` : "max-content").join(" "),
      } as CSSProperties}>
        {sections.map((sec) => (
          <section key={sec.group} className="sion-membres-groupe" aria-label={groupLabel(sec.group)}>
            <div className="sion-membres-groupe-titre">
              {groupLabel(sec.group)} — {sec.entries.length}
            </div>
            <div className="sion-membres-liste">
            {sec.entries.map((e) => {
              const vocal = connected ? voiceMembers.get(e.userId) : undefined;
              const salons = vocal ? [...vocal.salons.values()].join(", ") : "";
              const speaking = sec.group === "voice" && voiceConnected && !!connectedVoiceChannel &&
                vocal?.salons.has(connectedVoiceChannel) && participants.some((p) =>
                  (p.identity === e.userId || p.identity.startsWith(e.userId + ":")) && p.isSpeaking && !p.isMuted && !p.isDeafened);
              // Le vocal prouve la connexion même si Matrix n'annonce pas de présence.
              const presence = sec.group !== "offline" ? "online" : connected && e.presence === "offline" ? "offline" : undefined;
              return (
              <div
                key={e.userId}
                className="sion-membre"
                title={[e.displayName, salons, groupLabel(sec.group)].filter(Boolean).join(" — ")}
                {...gestesMenuContextuel((x, y) => openUserContextMenu({ userId: e.userId, userName: e.displayName, x, y }))}
                style={STYLE_SANS_SELECTION}
              >
                <UserAvatar className="sion-membre-avatar" name={e.displayName} size="md" speaking={false} avatarUrl={e.avatarUrl || undefined}
                  presence={presence}
                  presenceLabel={presence ? groupLabel(presence) : undefined} />
                <div className="sion-membre-identite" style={{ flex: 1, minWidth: 0 }}>
                  <span className="sion-membre-nom" style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: e.role === "admin" ? 'var(--color-primary)' : e.role === "moderator" ? 'var(--color-tertiary)' : 'var(--color-on-surface)',
                    fontWeight: e.role !== "user" ? 600 : 400,
                  }}>
                    {e.displayName}
                  </span>
                  {salons && <span className="sion-membre-salon" title={salons}>{salons}</span>}
                  {sec.group === "offline" && (!connected || !e.presence) && (
                    <span className="sion-membre-presence-inconnue">
                      {t("members.presenceUnknown", { defaultValue: "Présence inconnue" })}
                    </span>
                  )}
                </div>
                {sec.group === "afk" && (
                  <span className="sion-membre-afk" role="img" aria-label={groupLabel("afk")} title={t("members.deafened", { defaultValue: "AFK — sourdine activée" })}>
                    <HeadphoneIcon muted />
                  </span>
                )}
                {sec.group === "voice" && (
                  <span className={`sion-membre-onde${speaking ? " sion-membre-onde--parle" : ""}`} role="img" aria-label={groupLabel("voice")} title={groupLabel("voice")}>
                    <i /><i /><i /><i />
                  </span>
                )}
              </div>
              );
            })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
