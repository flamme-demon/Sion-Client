import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { lireEtat, verifierResponsable } from "../../services/espacesService";
import { salonCommun } from "../../utils/espaces";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { checkUserSuspended, suspendUser, getRoomsList, clearDeactivatedCache } from "../../services/adminService";
import { getMatrixClient } from "../../services/matrixService";
import { sendAdminCommand, findAdminRoom } from "../../services/adminCommandService";
import {
  usePendingUsersStore,
  getPublicRoomIds,
  isInAnyPublicRoom,
} from "../../stores/usePendingUsersStore";
import * as cacheRust from "../../services/cacheRust";
import { moteurRust } from "../../services/moteur";

interface UserEntry {
  userId: string;
  suspended: boolean;
  isolated: boolean;
}

function usePendingUsers() {
  const [pendingUsers, setPendingUsers] = useState<UserEntry[]>([]);
  const [activeUsers, setActiveUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const espaceActif = useEspacesStore((s) => s.espaceActif);
  const knownUserIds = usePendingUsersStore((s) => s._knownUserIds);
  const fullDiscover = usePendingUsersStore((s) => s.fullDiscover);

  const checkAll = useCallback(async () => {
    if (knownUserIds.size === 0) return;

    // Compute the public-room set once per pass instead of walking the
    // room graph for every user.
    const publicRoomIds = getPublicRoomIds();
    if (moteurRust()) await Promise.all(publicRoomIds.map((id) => cacheRust.detailsFrais(id).catch(() => null)));
    const pending: UserEntry[] = [];
    const active: UserEntry[] = [];

    for (const userId of knownUserIds) {
      let suspended = false;
      try {
        const result = await checkUserSuspended(userId);
        // Deactivated (= refused) or deleted accounts: neither pending nor active.
        if (result.deactivated) continue;
        suspended = result.suspended;
      } catch { /* assume not suspended on error */ }
      const isolated = !isInAnyPublicRoom(userId, publicRoomIds);
      if (suspended || isolated) {
        pending.push({ userId, suspended, isolated });
      } else {
        active.push({ userId, suspended: false, isolated: false });
      }
    }

    pending.sort((a, b) => a.userId.localeCompare(b.userId));
    active.sort((a, b) => a.userId.localeCompare(b.userId));

    if (useEspacesStore.getState().espaceActif !== espaceActif) return;
    setPendingUsers(pending);
    setActiveUsers(active);
  }, [knownUserIds, espaceActif]);

  // User-triggered refresh: full re-discovery (catches new registrations
  // that haven't joined any room yet), then per-user suspension check.
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Re-check accounts previously seen as deactivated (they may have
      // been reactivated via admin command since).
      clearDeactivatedCache();
      await fullDiscover();
      await checkAll();
    } finally {
      setLoading(false);
    }
  }, [fullDiscover, checkAll]);

  // React to knownUserIds changes (fullDiscover updates the store).
  useEffect(() => {
    queueMicrotask(() => { void checkAll(); });
  }, [checkAll]);

  return { pendingUsers, activeUsers, loading, refresh };
}

export function PendingUsers() {
  const { t } = useTranslation();
  const { pendingUsers, activeUsers: _activeUsers, loading, refresh } = usePendingUsers();
  const espaceActif = useEspacesStore((s) => s.espaceActif);
  const espace = useMatrixStore((s) => s.channels.find((c) => c.id === espaceActif && c.isSpace));
  const [approvalError, setApprovalError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const refreshPendingCount = usePendingUsersStore((s) => s.refresh);

  const handleApprove = async (userId: string) => {
    setActionLoading(userId); setApprovalError("");
    try {
      const espaces = useMatrixStore.getState().channels.filter((c) => c.isSpace);
      if (espaces.length && !espaceActif) throw new Error(t("spaces.selectForApproval"));
      if (espaceActif) await verifierResponsable(espaceActif);
      // 1. Unsuspend
      await suspendUser(userId, false);

      // L'admission dans l'équipe suit la validation du compte. Aucun autre Espace n'est parcouru.
      if (espaceActif) {
        const rooms = getPublicRoomIds();
        const echecs: string[] = [];
        for (const id of rooms) {
          if (id !== espaceActif && !salonCommun(await lireEtat(id, "m.room.join_rules"), espaceActif)) continue;
          try { await sendAdminCommand(`!admin users force-join-room ${userId} ${id}`); }
          catch { echecs.push(id); }
        }
        await refresh(); refreshPendingCount();
        if (echecs.length) throw new Error(t("spaces.approvalPartial", { count: echecs.length }));
        return;
      }
      // Avant la création du premier Espace, conserver l'admission historique.
      const adminRoomId = findAdminRoom();
      let roomIds: string[] = [];
      try {
        const res = await getRoomsList();
        const data = res as { rooms?: string[] };
        if (Array.isArray(data.rooms)) {
          roomIds = data.rooms;
        } else if (Array.isArray(res)) {
          roomIds = res as string[];
        }
      } catch {
        // Fallback : rooms visibles par le client
        const client = getMatrixClient();
        if (client) roomIds = client.getRooms().map((r) => r.roomId);
        if (moteurRust()) roomIds = cacheRust.salonsConnus().map((c) => c.id);
      }

      // 3. Joindre toutes les rooms sauf l'admin room et les DM
      const client = getMatrixClient();
      // Collecter les room IDs qui sont des DM
      const dmRoomIds = new Set<string>(moteurRust() ? cacheRust.salonsConnus().filter((c) => c.isDM).map((c) => c.id) : []);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const directEvent = client?.getAccountData("m.direct" as any);
        const directContent = (directEvent?.getContent() || {}) as Record<string, string[]>;
        for (const ids of Object.values(directContent)) {
          for (const id of ids) dmRoomIds.add(id);
        }
      } catch { /* ignore */ }

      for (const roomId of roomIds) {
        if (roomId === adminRoomId) continue;
        if (dmRoomIds.has(roomId)) continue;

        // Exclure aussi les rooms sans nom ni type (probablement des DM non taggés)
        const room = client?.getRoom(roomId);
        if (room && !room.name && room.getJoinedMemberCount() <= 2) continue;
        try {
          // Only auto-join PUBLIC channels. Private (invite-only) rooms
          // must stay invite-only — a newly approved user shouldn't be
          // force-joined into a private channel they were never invited to.
          const joinRuleEvent = room?.currentState.getStateEvents("m.room.join_rules", "");
          const joinRule = moteurRust()
            ? (await cacheRust.detailsFrais(roomId).catch(() => null))?.regleAcces
            : joinRuleEvent?.getContent?.()?.join_rule;
          if (joinRule !== "public") continue;
          await sendAdminCommand(`!admin users force-join-room ${userId} ${roomId}`);
        } catch {
          // Ignorer les erreurs individuelles
        }
      }

      await refresh();
      refreshPendingCount();
    } catch (err) {
      console.error("[Sion] Failed to approve user:", err);
      setApprovalError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (userId: string) => {
    setActionLoading(userId);
    try {
      await sendAdminCommand(`!admin users deactivate ${userId}`);
      await refresh();
      refreshPendingCount();
    } catch (err) {
      console.error("[Sion] Failed to reject user:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const extractName = (userId: string) => {
    const match = userId.match(/^@([^:]+):/);
    return match ? match[1] : userId;
  };

  return (
    <>
      {espace && <p style={{ color: "var(--color-on-surface-variant)", fontSize: 13 }}>{t("spaces.approvalScope", { name: espace.name })}</p>}
      {approvalError && <p role="alert" style={{ color: "var(--color-error)" }}>{approvalError}</p>}
      {/* Pending approvals */}
      <div style={{
        background: 'var(--color-surface-container)',
        borderRadius: 16,
        padding: '14px 8px',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 8px',
          marginBottom: 8,
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            color: 'var(--color-on-surface-variant)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            {t("admin.pending.title")}
            {pendingUsers.length > 0 && (
              <span style={{
                background: 'var(--color-error)',
                color: 'var(--color-on-error)',
                borderRadius: 10,
                padding: '1px 7px',
                fontSize: 10,
                fontWeight: 700,
              }}>
                {pendingUsers.length}
              </span>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              color: 'var(--color-on-surface-variant)',
              fontSize: 14,
              padding: '2px 6px',
              borderRadius: 8,
              opacity: loading ? 0.4 : 0.7,
            }}
            title={t("admin.pending.refresh")}
          >
            ↻
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--color-outline)', fontSize: 12 }}>
            ...
          </div>
        ) : pendingUsers.length === 0 ? (
          <div style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--color-outline)', fontSize: 12 }}>
            {t("admin.pending.none")}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pendingUsers.map((user) => (
              <div
                key={user.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: 12,
                  background: 'var(--color-surface-container-high)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-on-surface)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {extractName(user.userId)}
                    </span>
                    {user.suspended ? (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: 'var(--color-error-container)',
                        color: 'var(--color-error)',
                        borderRadius: 6,
                        padding: '1px 6px',
                        flexShrink: 0,
                      }}>
                        {t("admin.pending.badgeSuspended")}
                      </span>
                    ) : user.isolated ? (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: 'var(--color-tertiary-container)',
                        color: 'var(--color-on-tertiary-container)',
                        borderRadius: 6,
                        padding: '1px 6px',
                        flexShrink: 0,
                      }}>
                        {t("admin.pending.badgeToken")}
                      </span>
                    ) : null}
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: 'var(--color-outline)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {user.userId}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                  <button
                    onClick={() => handleApprove(user.userId)}
                    disabled={actionLoading === user.userId}
                    title={t("admin.pending.approve")}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 14,
                      border: 'none',
                      cursor: actionLoading === user.userId ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      background: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      opacity: actionLoading === user.userId ? 0.5 : 1,
                    }}
                  >
                    ✔
                  </button>
                  <button
                    onClick={() => handleReject(user.userId)}
                    disabled={actionLoading === user.userId}
                    title={t("admin.pending.reject")}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 14,
                      border: 'none',
                      cursor: actionLoading === user.userId ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      background: 'var(--color-error-container)',
                      color: 'var(--color-error)',
                      opacity: actionLoading === user.userId ? 0.5 : 1,
                    }}
                  >
                    ✗
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  );
}
