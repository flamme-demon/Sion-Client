// @refresh reset
// En dev, repartir sur un montage propre quand le calcul des compteurs change.
import { useMemo } from "react";
import { useMatrixStore } from "../stores/useMatrixStore";
import { useAppStore, APP_SESSION_START_TS } from "../stores/useAppStore";
import { findAdminRoom } from "../services/adminCommandService";
import { useEspacesStore } from "../stores/useEspacesStore";
import { salonsDansEspace } from "../utils/espaces";

/** Compteurs isolés des listes de salons pour ne pas les rafraîchir à chaque message. */
export function useNonLusNavigation() {
  const channels = useMatrixStore((s) => s.channels);
  const messages = useMatrixStore((s) => s.messages);
  const currentUserId = useMatrixStore((s) => s.currentUserId);
  const lastReadMessageId = useAppStore((s) => s.lastReadMessageId);
  const activeChannel = useAppStore((s) => s.activeChannel);
  const hierarchies = useEspacesStore((s) => s.hierarchies);
  const parentsParSalon = useMemo(() => {
    const parentsParSalon = new Map<string, string[]>();
    for (const espace of channels.filter((c) => c.isSpace)) for (const salon of salonsDansEspace(channels, espace.id, hierarchies)) {
      const parents = parentsParSalon.get(salon.id) ?? [];
      parents.push(espace.id); parentsParSalon.set(salon.id, parents);
    }
    return parentsParSalon;
  }, [channels, hierarchies]);

  return useMemo(() => {
    const adminRoom = findAdminRoom();
    let unreadChannels = 0;
    let unreadDMs = 0;
    const unreadEspaces: Record<string, number> = {};
    const isUnreadMsg = (m: { senderId?: string }) => !currentUserId || m.senderId !== currentUserId;
    const sessionFilter = (m: { ts?: number; senderId?: string }) =>
      (m.ts ?? 0) > APP_SESSION_START_TS && isUnreadMsg(m);

    for (const ch of channels) {
      if (ch.isSpace || ch.isSoundboard || ch.membership === "invite" || ch.id === adminRoom || ch.id === activeChannel) continue;
      const msgs = messages[ch.id];
      if (!msgs?.length) continue;
      const lastReadId = lastReadMessageId[ch.id];
      const idx = lastReadId ? msgs.findIndex((m) => (m.eventId || String(m.id)) === lastReadId) : -1;
      // Sans repère chargé, ignorer l'historique provenant de la synchronisation initiale.
      const unread = idx < 0 ? msgs.filter(sessionFilter).length : msgs.slice(idx + 1).filter(isUnreadMsg).length;
      if (!unread) continue;
      if (ch.isDM) unreadDMs += unread;
      else {
        const parents = parentsParSalon.get(ch.id) ?? [];
        if (!parents.length) unreadChannels += unread;
        for (const parent of parents) unreadEspaces[parent] = (unreadEspaces[parent] ?? 0) + unread;
      }
    }
    return { unreadChannels, unreadDMs, unreadEspaces };
  }, [channels, messages, currentUserId, lastReadMessageId, activeChannel, parentsParSalon]);
}
