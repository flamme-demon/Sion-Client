import { useEspacesStore } from "../../stores/useEspacesStore";
import { choisirEspace } from "../../hooks/useEspaces";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { HashIcon, HomeIcon, MessageBubbleIcon, PlusIcon } from "../icons";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore, APP_SESSION_START_TS } from "../../stores/useAppStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useSettingsStore, type SidebarView } from "../../stores/useSettingsStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { findAdminRoom } from "../../services/adminCommandService";
import { getMatrixClient, leaveRoom } from "../../services/matrixService";
import * as cacheRust from "../../services/cacheRust";
import { moteurRust } from "../../services/moteur";
import { nomServeur } from "../../utils/nomServeur";

/** Les mêmes espaces sur desktop (rail) et mobile (onglets). */
export function NavigationEspaces({ rail = false }: { rail?: boolean }) {
  const { t } = useTranslation();
  const channels = useMatrixStore((s) => s.channels);
  const espaceActif = useEspacesStore((s) => s.espaceActif);
  const espaces = channels.filter((c) => c.isSpace);
  const sidebarView = useSettingsStore((s) => s.sidebarView);
  const credentials = useAuthStore((s) => s.credentials);
  const serveur = nomServeur(credentials?.homeserverUrl);
  const allMessages = useMatrixStore((s) => s.messages);
  const lastReadMessageId = useAppStore((s) => s.lastReadMessageId);
  const activeChannel = useAppStore((s) => s.activeChannel);
  const currentUserId = useMatrixStore((s) => s.currentUserId);

  const { unreadChannels, unreadDMs, unreadEspaces } = useMemo(() => {
    const adminRoom = findAdminRoom();
    let chCount = 0;
    let dmCount = 0;
    const espacesNonLus: Record<string, number> = {};
    const groupes = channels.filter((c) => c.isSpace);
    // Own messages (e.g. poke sent by the user) never count as unread.
    const isUnreadMsg = (m: { senderId?: string }) => !currentUserId || m.senderId !== currentUserId;
    for (const ch of channels) {
      if (ch.isSpace || ch.isSoundboard || ch.id === adminRoom || ch.id === activeChannel) continue;
      const msgs = allMessages[ch.id];
      if (!msgs || msgs.length === 0) continue;
      const lastReadId = lastReadMessageId[ch.id];
      const sessionFilter = (m: { ts?: number; senderId?: string }) =>
        (m.ts ?? 0) > APP_SESSION_START_TS && isUnreadMsg(m);
      let unread: number;
      if (!lastReadId) {
        // Channel never opened: ignore historical messages from initial sync,
        // only count messages received during the current session.
        unread = msgs.filter(sessionFilter).length;
      } else {
        const idx = msgs.findIndex((m) => (m.eventId || String(m.id)) === lastReadId);
        if (idx === -1) {
          // lastReadId outside loaded window — fall back to session-start filter.
          unread = msgs.filter(sessionFilter).length;
        } else {
          unread = msgs.slice(idx + 1).filter(isUnreadMsg).length;
        }
      }
      if (unread > 0) {
        if (ch.isDM) dmCount += unread;
        else {
          const parents = groupes.filter((s) => s.spaceChildren?.includes(ch.id));
          if (!parents.length) chCount += unread;
          for (const parent of parents) espacesNonLus[parent.id] = (espacesNonLus[parent.id] ?? 0) + unread;
        }
      }
    }
    return { unreadChannels: chCount, unreadDMs: dmCount, unreadEspaces: espacesNonLus };
  }, [channels, allMessages, lastReadMessageId, activeChannel, currentUserId]);

  const derniers = useRef<{ utilisateur: string | null; channels: string | null; dm: string | null }>({
    utilisateur: currentUserId, channels: null, dm: null,
  });
  useEffect(() => {
    if (derniers.current.utilisateur !== currentUserId) {
      derniers.current = { utilisateur: currentUserId, channels: null, dm: null };
    }
    const salon = channels.find((c) => c.id === activeChannel);
    if (salon && !salon.isSoundboard && !salon.isSpace) derniers.current[salon.isDM ? "dm" : "channels"] = salon.id;
  }, [activeChannel, channels, currentUserId]);

  const choisir = (espace: SidebarView) => {
    useSettingsStore.getState().setSidebarView(espace);
    const layout = useLayoutStore.getState();
    if (rail && layout.sidebarMode === "hidden") layout.setSidebarMode("rail");
    // Revenir à la dernière conversation de cet espace n'agit pas sur le vocal.
    if (rail) {
      const dernier = channels.find((c) => c.id === derniers.current[espace]
        && !c.isSoundboard && !!c.isDM === (espace === "dm"));
      if (dernier && dernier.id !== activeChannel) {
        useAppStore.getState().setActiveChannel(dernier.id, dernier.hasVoice);
      }
    }
  };
  const classe = rail ? "sion-rail-bouton" : "sion-espace-onglet";
  const compteur = (nombre: number) => nombre > 0 && <span className="sion-rail-compteur" aria-hidden="true">{nombre > 99 ? "99+" : nombre}</span>;
  const nonLus = (nombre: number) => nombre > 0 ? ` — ${t("chat.unreadCount", { count: nombre })}` : "";
  const boutonServeur = (
    <button type="button" className={classe} data-espace="channels"
      aria-label={(rail ? t("server.navigation", { server: serveur, defaultValue: `${t("layout.channels")} — ${serveur}` }) : t("channels.tabChannels")) + nonLus(unreadChannels)}
      title={rail ? t("server.navigation", { server: serveur, defaultValue: `${t("layout.channels")} — ${serveur}` }) : t("channels.tabChannels")}
      aria-pressed={sidebarView === "channels" && !espaceActif} onClick={() => { choisirEspace(null); choisir("channels"); }}>
      {rail ? <span className="sion-serveur-monogramme" aria-hidden="true">S</span> : <><HashIcon />{t("channels.tabChannels")}</>}
      {compteur(unreadChannels)}
    </button>
  );
  const boutonMp = (
    <button type="button" className={classe} data-espace="dm"
      aria-label={t("channels.tabDM") + nonLus(unreadDMs)} title={t("channels.tabDM")}
      aria-pressed={sidebarView === "dm"} onClick={() => choisir("dm")}
      onContextMenu={async (e) => {
        e.preventDefault();
        const myUserId = useMatrixStore.getState().currentUserId;
        const empties = channels.filter((ch) =>
          ch.isDM
          && (ch.voiceUsers?.length ?? 0) === 0
          && !!myUserId
          // Only "empty" DMs: ours is the sole surviving member
          && (() => {
            if (moteurRust()) {
              const membres = cacheRust.detailsSalon(ch.id)?.membres ?? [];
              return membres.length === 1 && membres[0].userId === myUserId;
            }
            try {
              const cli = getMatrixClient();
              const room = cli?.getRoom(ch.id);
              if (!room) return false;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const live = (room.getMembers?.() || []).filter((m: any) =>
                m.membership === "join" || m.membership === "invite",
              );
              return live.length === 1 && live[0].userId === myUserId;
            } catch { return false; }
          })()
        );
        if (empties.length === 0) {
          window.alert("Aucune conversation vide à nettoyer.");
          return;
        }
        if (!window.confirm(`Quitter ${empties.length} conversation(s) vide(s) ?`)) return;
        const cli = getMatrixClient();
        for (const ch of empties) {
          try {
            if (moteurRust()) await leaveRoom(ch.id);
            else await cli?.leave(ch.id);
          } catch (err) {
            console.warn("[Sion][DM] bulk leave failed for", ch.id, err);
          }
        }
        window.alert(`${empties.length} conversation(s) vide(s) quittée(s).`);
      }}>
      {rail ? <HomeIcon /> : <><MessageBubbleIcon />{t("channels.tabDM")}</>}
      {compteur(unreadDMs)}
    </button>
  );
  const boutonsEspaces = espaces.map((espace) => <button type="button" key={espace.id} data-space-id={espace.id} className={classe}
    title={espace.name} aria-label={`${espace.name}${nonLus(unreadEspaces[espace.id] ?? 0)}${espace.membership === "invite" ? ` — ${t("spaces.invitation")}` : ""}`}
    aria-pressed={sidebarView === "channels" && espaceActif === espace.id}
    onClick={() => { choisirEspace(espace.id); if (espace.membership === "invite") useEspacesStore.getState().ouvrir("gerer"); }}
    onContextMenu={(e) => { e.preventDefault(); choisirEspace(espace.id); useEspacesStore.getState().ouvrir("gerer"); }}>
    {espace.icon ? <img className="sion-espace-avatar" src={espace.icon} alt="" /> : <span aria-hidden="true">{espace.name.slice(0, 2).toUpperCase()}</span>}
    {espace.membership === "invite" ? <span className="sion-rail-compteur">!</span> : compteur(unreadEspaces[espace.id] ?? 0)}
  </button>);
  const ajouter = <button className={classe} type="button" aria-label={t("spaces.add")} title={t("spaces.add")}
    onClick={() => useEspacesStore.getState().ouvrir("ajouter")}><PlusIcon /></button>;
  return <div className={`sion-navigation-espaces sion-navigation-espaces--${rail ? "rail" : "onglets"}`}>
    {rail ? <>{boutonMp}<hr className="sion-rail-separation" /><div className="sion-espaces-rail-liste">{boutonServeur}{boutonsEspaces}{ajouter}</div></> : <>{boutonMp}{boutonServeur}{boutonsEspaces}{ajouter}</>}
  </div>;
}
