import { RecherchePanneau } from "./RecherchePanneau";
import { useCompteurPanneau } from "../layout/panneauxCompteurs";
import { SoundboardIcon } from "../icons";
import { ActionsCarteBoard } from "./ActionsCarteBoard";
import { ConfirmationSuppressionBoard } from "./ConfirmationSuppressionBoard";
import { useEffect, useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/useAppStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import {
  listSounds,
  getSoundboardRoomId,
  playSoundLocal,
  broadcastSound,
  playErrorBuzzer,
  setPlaybackVolume,
  deleteSound,
  invalidateSoundCache,
  fetchSoundFile,
  SOUNDBOARD_MAX_FILE_SIZE,
  type SoundEntry,
} from "../../services/soundboardService";
import { canSendMessage, getMatrixClient, getMemberPowerLevel, getRoomMembers } from "../../services/matrixService";
import { moteurRust } from "../../services/moteur";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { SoundboardUploadModal } from "./SoundboardUploadModal";
import { VoicePanel } from "./VoicePanel";
import { TTS_MODEL_LABELS } from "../../services/ttsService";
import { HotkeyCaptureModal } from "./HotkeyCaptureModal";
import { formatCombo } from "../../utils/keyCombo";
import { UserAvatar } from "../sidebar/UserAvatar";
import { loadHotkeys, onHotkeysChange, pruneHotkeys, resyncHotkeys } from "../../services/soundboardHotkeys";
import { SUR_ANDROID } from "../../utils/plateforme";
import { buildTree, findNode, sortedChildren, parentPath } from "../../utils/categories";
import { FiltreBoardCompact } from "./FiltreBoardCompact";
import "./BoardPanel.css";

type FilterMode = "all" | "top";

export function SoundboardPanel() {
  const { t } = useTranslation();
  const espacesPresents = useMatrixStore((s) => s.channels.some((c) => c.isSpace));
  const connectedVoice = useAppStore((s) => s.connectedVoiceChannel);
  const [sounds, setSounds] = useState<SoundEntry[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Restore the last active view (filter + category) from the persisted store.
  const [selectedCat, setSelectedCat] = useState<string | null>(() => useSettingsStore.getState().soundboardView.category);
  const [filterMode, setFilterMode] = useState<FilterMode>(() => useSettingsStore.getState().soundboardView.mode);
  const setSoundboardView = useSettingsStore((s) => s.setSoundboardView);
  const [showUpload, setShowUpload] = useState(false);
  const [tab, setTab] = useState<"sounds" | "voices" | "members">("sounds");
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [hotkeyTarget, setHotkeyTarget] = useState<SoundEntry | null>(null);
  const [editTarget, setEditTarget] = useState<SoundEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SoundEntry | null>(null);
  const [hotkeysTick, setHotkeysTick] = useState(0);
  const volume = useSettingsStore((s) => s.soundboardVolume);
  const setVolume = useSettingsStore((s) => s.setSoundboardVolume);
  const enabled = useSettingsStore((s) => s.soundboardEnabled);
  const setEnabled = useSettingsStore((s) => s.setSoundboardEnabled);
  const hiddenCategories = useSettingsStore((s) => s.hiddenCategories);
  const toggleCategoryHidden = useSettingsStore((s) => s.toggleCategoryHidden);
  const playCounts = useSettingsStore((s) => s.soundboardPlayCounts);
  const incrementPlay = useSettingsStore((s) => s.incrementSoundboardPlay);
  const refreshRef = useRef<() => void>(() => {});

  // Apply volume on first render so receivers pick it up
  useEffect(() => {
    setPlaybackVolume(volume);
  }, [volume]);

  // Remember the active view so reopening the panel lands where you left off.
  useEffect(() => {
    setSoundboardView({ mode: filterMode, category: selectedCat });
  }, [filterMode, selectedCat, setSoundboardView]);

  // Subscribe to hotkey changes so the badges re-render + resync on open
  useEffect(() => {
    const unsub = onHotkeysChange(() => setHotkeysTick((n) => n + 1));
    resyncHotkeys();
    return () => { unsub(); };
  }, []);

  // Prune hotkeys that reference deleted sounds
  useEffect(() => {
    if (sounds.length === 0 || espacesPresents) return;
    pruneHotkeys(new Set(sounds.map((s) => s.eventId)));
  }, [sounds, espacesPresents]);

  const hotkeys = useMemo(() => { void hotkeysTick; return loadHotkeys(); }, [hotkeysTick]);

  // Refresh sound list on demand + when soundboard room timeline changes.
  // (See the long comment history: must filter on the soundboard room id and
  // debounce, or busy-room scrollback sature le pool de connexions du webview.)
  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let cachedRoomId: string | null = null;
    let loading = false;
    let requested = false;

    const refresh = async () => {
      if (cancelled) return;
      if (loading) { requested = true; return; }
      loading = true;
      try {
        const rid = await getSoundboardRoomId();
        if (cancelled) return;
        cachedRoomId = rid;
        setRoomId(rid);
        const list = await listSounds();
        if (!cancelled) setSounds(list);
      } catch (err) {
        if (!cancelled) console.warn("[Sion][soundboard] rafraîchissement impossible", err);
      } finally {
        loading = false;
        if (requested && !cancelled) { requested = false; void refresh(); }
      }
    };
    refreshRef.current = refresh;
    refresh();

    if (moteurRust()) {
      // Le fil du salon de la soundboard, republié par le cœur à chaque
      // changement (ajout, édition, suppression).
      let arreter: (() => void) | null = null;
      void import("../../services/matrixCore").then(({ surMessages }) =>
        surMessages((fil) => {
          if (!cachedRoomId || fil.salon !== cachedRoomId) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => { void refresh(); }, 200);
        }).then((stop) => {
          if (cancelled) stop();
          else arreter = stop;
        }),
      );
      return () => {
        cancelled = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        arreter?.();
      };
    }

    const client = getMatrixClient();
    if (!client) return () => { cancelled = true; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onTimeline = (_event: any, room: any) => {
      if (!room || !cachedRoomId || room.roomId !== cachedRoomId) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void refresh(); }, 200);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onRedaction = (event: any, room: any) => {
      if (!room || !cachedRoomId || room.roomId !== cachedRoomId) {
        if (event?.getRoomId?.() !== cachedRoomId) return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void refresh(); }, 200);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cl = client as any;
    cl.on("Room.timeline", onTimeline);
    cl.on("Room.redaction", onRedaction);
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      cl.off("Room.timeline", onTimeline);
      cl.off("Room.redaction", onRedaction);
    };
  }, []);

  // Le salon soundboard peut ne pas être connu au premier essai (panneau
  // monté tôt — au boot ou juste après un changement de salon, sync Matrix en
  // cours) : on retente tant qu'il manque. L'intervalle meurt avec le
  // démontage du panneau (il n'est monté que si un salon soundboard existe).
  useEffect(() => {
    if (roomId) return;
    const id = setInterval(() => { void refreshRef.current(); }, 2000);
    return () => clearInterval(id);
  }, [roomId]);

  const canUpload = roomId ? canSendMessage(roomId) : false;

  const client = getMatrixClient();
  const currentUserId = useMatrixStore((s) => s.currentUserId);
  const myUserId = client?.getUserId() || currentUserId || "";
  const myPl = roomId && myUserId ? getMemberPowerLevel(roomId, myUserId) : 0;
  const canManageMembers = myPl >= 100 && !!roomId;

  const members = useMemo(() => {
    void sounds; // re-evaluate when roomId changes
    if (!roomId) return [];
    if (moteurRust()) {
      return getRoomMembers(roomId)
        .map((m) => ({ userId: m.userId, name: m.displayName, avatarUrl: m.avatarUrl, pl: getMemberPowerLevel(roomId, m.userId) }))
        .sort((a, b) => b.pl - a.pl || a.name.localeCompare(b.name));
    }
    if (!client) return [];
    const room = client.getRoom(roomId);
    if (!room) return [];
    return room.getJoinedMembers()
      .map((m) => ({
        userId: m.userId,
        name: m.name || m.userId,
        avatarUrl: m.getAvatarUrl(client.baseUrl, 64, 64, "crop", true, false) || null,
        pl: getMemberPowerLevel(roomId, m.userId),
      }))
      .sort((a, b) => b.pl - a.pl || a.name.localeCompare(b.name));
  }, [roomId, client, sounds]);

  const handleSetPl = async (userId: string, level: number) => {
    if (!roomId) return;
    try {
      const { setUserPowerLevel } = await import("../../services/matrixService");
      await setUserPowerLevel(roomId, userId, level);
      refreshRef.current();
    } catch (err) {
      console.error("[Sion] setPowerLevel failed:", err);
      setErrorToast(t("soundboard.plError"));
      setTimeout(() => setErrorToast(null), 3000);
    }
  };

  const hiddenCategoriesSet = useMemo(() => new Set(hiddenCategories), [hiddenCategories]);

  const isCategoryHidden = (cat: string): boolean => {
    if (hiddenCategoriesSet.has(cat)) return true;
    const parts = cat.split("/").filter(Boolean);
    let path = "";
    for (const p of parts) {
      path = path ? `${path}/${p}` : p;
      if (hiddenCategoriesSet.has(path)) return true;
    }
    return false;
  };

  // Les extraits de référence TTS vivent dans la même room mais ne sont pas des
  // sons jouables : ils sont exclus de la grille, des catégories et du compteur.
  const playable = useMemo(() => sounds.filter((s) => s.kind !== "voice"), [sounds]);

  const tree = useMemo(() => buildTree(Array.from(new Set(playable.map((s) => s.category)))), [playable]);
  const topLevels = useMemo(() => sortedChildren(tree), [tree]);
  // Sub-category row anchor: if the selected category has children, we're
  // browsing *inside* it (show its children, "Tout X" active). If it's a leaf,
  // anchor on its parent so the row keeps showing the siblings with the leaf
  // highlighted — otherwise the row would vanish on clicking a leaf.
  const selectedNode = filterMode === "all" ? findNode(tree, selectedCat) : null;
  const anchorNode = !selectedCat
    ? null
    : (selectedNode && selectedNode.children.size > 0 ? selectedNode : findNode(tree, parentPath(selectedCat)));
  const anchorChildren = sortedChildren(anchorNode);
  const showSubRow = filterMode === "all" && !!anchorNode && anchorNode.name !== "" && anchorChildren.length > 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesQuery = (s: SoundEntry) =>
      !q || s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);

    if (filterMode === "top") {
      // Most-played first; ties broken by label. Only sounds played at least once.
      return playable
        .filter((s) => (playCounts[s.eventId] || 0) > 0 && matchesQuery(s))
        .sort((a, b) => (playCounts[b.eventId] || 0) - (playCounts[a.eventId] || 0) || a.label.localeCompare(b.label));
    }
    // "all" mode: category drill-down + hidden-category handling.
    return playable.filter((s) => {
      if (selectedCat && !s.category.startsWith(selectedCat)) return false;
      if (isCategoryHidden(s.category)) {
        if (!selectedCat || !s.category.startsWith(selectedCat)) return false;
        const selectedIsOrInHidden = Array.from(hiddenCategoriesSet).some(
          (h) => selectedCat === h || selectedCat.startsWith(h + "/"),
        );
        if (!selectedIsOrInHidden) return false;
      }
      return matchesQuery(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playable, search, selectedCat, filterMode, hiddenCategoriesSet, playCounts]);

  const handlePlay = async (s: SoundEntry) => {
    if (!enabled) return;
    incrementPlay(s.eventId);
    try {
      // Durée mesurée à la lecture : `info.duration` peut manquer (sonde
      // d'upload en échec) ou mentir, et c'est elle qui règle la fin du rond
      // chez tout le monde.
      const measuredMs = await playSoundLocal(s.mxcUrl, s.gain);
      if (connectedVoice) broadcastSound(s.mxcUrl, s.emoji, measuredMs ?? s.duration, s.gain);
    } catch (err) {
      console.warn("[Sion] play failed:", err);
      playErrorBuzzer();
      invalidateSoundCache(s.mxcUrl);
      setErrorToast(t("soundboard.playError"));
      setTimeout(() => setErrorToast(null), 5000);
    }
  };

  const handleDelete = async (s: SoundEntry) => {
    await deleteSound(s.eventId);
    invalidateSoundCache(s.mxcUrl);
    refreshRef.current();
  };

  // Translate vertical wheel into horizontal scroll so the pill rows are
  // navigable with a plain mouse wheel (no horizontal trackpad needed).
  const onPillWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
  };

  // ── Reusable pill button ────────────────────────────────────────────────
  const pill = (
    key: string,
    label: React.ReactNode,
    active: boolean,
    onClick: () => void,
    opts?: { onContextMenu?: (e: React.MouseEvent) => void; dim?: boolean; title?: string },
  ) => (
    <button
      key={key} aria-pressed={active} data-filter={key}
      type="button"
      onClick={onClick}
      onContextMenu={opts?.onContextMenu}
      title={opts?.title}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
        padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
        border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
        background: active ? 'var(--color-primary)' : 'transparent',
        color: active ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
        opacity: opts?.dim ? 0.5 : 1,
        textDecoration: opts?.dim ? 'line-through' : 'none',
      }}
    >{label}</button>
  );


  useCompteurPanneau("soundboard", playable.length);

  const tabDefs = [
    { key: "sounds" as const, label: t("soundboard.tabSounds"), show: true },
    // Voix clonées : modèles locaux, pas sur téléphone.
    { key: "voices" as const, label: t("tts.tab"), show: canUpload && !SUR_ANDROID },
    { key: "members" as const, label: `${t("soundboard.tabMembers")} · ${members.length}`, show: canManageMembers },
  ].filter((x) => x.show);

  const volumeControl = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, color: 'var(--color-on-surface-variant)' }}>
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        aria-pressed={enabled}
        aria-label={enabled ? t("soundboard.disableSb") : t("soundboard.enableSb")}
        title={enabled ? t("soundboard.disableSb") : t("soundboard.enableSb")}
        style={{ flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, borderRadius: 8, display: 'flex', color: enabled ? 'var(--color-on-surface)' : 'var(--color-error)' }}
      >
        <SoundboardIcon muted={!enabled} size={18} />
      </button>
      <input
        type="range" min={0} max={1} step={0.05} value={volume}
        className="sion-range"
        disabled={!enabled}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        style={{
          minWidth: 0, flex: 1,
          opacity: enabled ? 1 : 0.4,
          cursor: enabled ? 'pointer' : 'not-allowed',
          '--sion-range-progress': `${Math.round(volume * 100)}%`,
        } as React.CSSProperties}
        aria-label={t("soundboard.volume")} title={t("soundboard.volume")}
      />
      <span style={{ minWidth: 30, textAlign: 'right', fontSize: 11, opacity: enabled ? 1 : 0.4 }}>{Math.round(volume * 100)}%</span>
    </div>
  );

  return (
    <div className="soundboard-panel sion-board" data-tab={tab} data-prete={!!roomId} data-onglets={!!roomId && (canUpload || canManageMembers)}>
      <style>{`
        /* Scrollbar masquée — navigation à la molette (onPillWheel). */
        .sb-pills { scrollbar-width: none; -ms-overflow-style: none; }
        .sb-pills::-webkit-scrollbar { height: 0; width: 0; }
      `}</style>

      {(
        <>
          {/* Tabs — défilement horizontal (masqué) pour ne jamais rogner quand le
              panneau est étroit. */}
          {roomId && (canUpload || canManageMembers) && (
            <div className="sb-pills sion-board-onglets" onWheel={onPillWheel}>
              <select className="sion-board-onglets-select" aria-label={t("soundboard.title")} value={tab}
                onChange={(e) => setTab(e.currentTarget.value as typeof tab)}>
                {tabDefs.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              {tabDefs.map((x) => (
                <button
                  key={x.key}
                  onClick={() => setTab(x.key)}
                  style={{
                    padding: '8px 0', border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap',
                    borderBottom: tab === x.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                    color: tab === x.key ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                  }}
                >{x.label}</button>
              ))}
            </div>
          )}
        </>
      )}

      {!roomId && (
        <div className="sion-board-vide" style={{ padding: 20, fontSize: 12, color: 'var(--color-outline)', textAlign: 'center' }}>
          {t("soundboard.notCreated")}
        </div>
      )}

      {roomId && tab === "voices" && canUpload && (
        <div className="sion-board-alternative">
        <VoicePanel
          sounds={sounds}
          resolveSound={fetchSoundFile}
          onUploaded={() => refreshRef.current()}
          connectedVoice={!!connectedVoice}
        />
        </div>
      )}

      {roomId && tab === "members" && canManageMembers && (
        <div className="sion-board-alternative" style={{ padding: 12 }}>
          {members.map((m) => {
            const isMe = m.userId === myUserId;
            const role = m.pl >= 100 ? "admin" : m.pl >= 50 ? "mod" : "user";
            return (
              <div key={m.userId} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: 6,
                borderRadius: 8, marginBottom: 4, background: 'var(--color-surface-container)',
              }}>
                <UserAvatar name={m.name} size="sm" speaking={false} avatarUrl={m.avatarUrl || undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: role !== "user" ? 600 : 400,
                    color: role === "admin" ? 'var(--color-primary)' : role === "mod" ? 'var(--color-tertiary)' : 'var(--color-on-surface)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{m.name} {isMe && "(vous)"}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-outline)' }}>
                    {role === "admin" ? t("contextMenu.roleAdmin") : role === "mod" ? t("contextMenu.roleModerator") : t("contextMenu.roleUser")}
                  </div>
                </div>
                {!isMe && role !== "admin" && (
                  role === "mod" ? (
                    <button onClick={() => handleSetPl(m.userId, 0)}
                      style={{ padding: '4px 10px', fontSize: 11, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--color-error-container)', color: 'var(--color-error)', fontFamily: 'inherit' }}
                    >{t("soundboard.demote")}</button>
                  ) : (
                    <button onClick={() => handleSetPl(m.userId, 50)}
                      style={{ padding: '4px 10px', fontSize: 11, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)', fontFamily: 'inherit' }}
                    >{t("soundboard.promote")}</button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {roomId && tab === "sounds" && (
        <>
          <div className="sion-board-outils" onWheel={onPillWheel}>
          {/* Recherche et ajout réunis dans un même champ. */}
          {(
            <div className="sion-board-recherche">
              <RecherchePanneau valeur={search} onChange={setSearch} libelle={t("soundboard.searchPlaceholder")}
                ajout={canUpload ? { libelle: t("soundboard.upload"), onClick: () => setShowUpload(true) } : undefined} />
            </div>
          )}

          {/* Quick-filter + top-level category pills */}
          <div className="sb-pills sion-board-filtres-larges" onWheel={onPillWheel} style={{ display: 'flex', gap: 8, padding: '4px 16px 8px', overflowX: 'auto', flexShrink: 0 }}>
            {pill("top", <>🔥 {t("soundboard.top")}</>, filterMode === "top", () => { setFilterMode("top"); setSelectedCat(null); })}
            {pill("all", t("soundboard.allCategories"), filterMode === "all" && selectedCat === null, () => { setFilterMode("all"); setSelectedCat(null); })}
            {topLevels.map((c) => pill(
              c.fullPath,
              c.name,
              filterMode === "all" && !!selectedCat && (selectedCat === c.fullPath || selectedCat.startsWith(c.fullPath + "/")),
              () => { setFilterMode("all"); setSelectedCat(c.fullPath); },
              {
                dim: isCategoryHidden(c.fullPath),
                title: isCategoryHidden(c.fullPath) ? t("soundboard.categoryHidden") : t("soundboard.rightClickHide"),
                onContextMenu: (e) => { e.preventDefault(); toggleCategoryHidden(c.fullPath); },
              },
            ))}
          </div>

          {/* Sub-category drill-down */}
          {showSubRow && anchorNode && (
            <div className="sb-pills sion-board-filtres-larges" onWheel={onPillWheel} style={{ display: 'flex', gap: 8, padding: '0 16px 8px', overflowX: 'auto', alignItems: 'center', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setSelectedCat(parentPath(anchorNode.fullPath))}
                title={t("soundboard.back")}
                style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 999, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-on-surface-variant)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              {pill("__all", t("soundboard.allOf", { name: anchorNode.name }), selectedCat === anchorNode.fullPath, () => setSelectedCat(anchorNode.fullPath))}
              {anchorChildren.map((c) => pill(
                c.fullPath,
                c.name,
                selectedCat === c.fullPath || (!!selectedCat && selectedCat.startsWith(c.fullPath + "/")),
                () => setSelectedCat(c.fullPath),
                {
                  dim: isCategoryHidden(c.fullPath),
                  onContextMenu: (e) => { e.preventDefault(); toggleCategoryHidden(c.fullPath); },
                },
              ))}
            </div>
          )}

          <FiltreBoardCompact arbre={tree} mode={filterMode} categorie={selectedCat}
            toutes={t("soundboard.allCategories")} libelle={t("soundboard.category")}
            onChange={(mode, categorie) => { setFilterMode(mode); setSelectedCat(categorie); }}
            onMasquer={toggleCategoryHidden} />
          </div>

          {/* Sound cards */}
          <div className="sion-board-contenu" onWheel={(e) => {
            if (getComputedStyle(e.currentTarget).overflowY === "hidden") onPillWheel(e);
          }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, fontSize: 12, color: 'var(--color-outline)', textAlign: 'center' }}>
                {filterMode === "top" ? t("soundboard.noTop") : t("soundboard.empty")}
              </div>
            ) : (
              <div className="soundboard-grid">
                {filtered.map((s) => {
                  const hotkey = hotkeys[s.eventId] || null;
                  const subtitle = s.category.replace(/\//g, " · ");
                  return (
                    <div
                      key={s.eventId}
                      className="sound-card sion-carte-board"
                      onClick={() => handlePlay(s)}
                      onContextMenu={(ev) => { ev.preventDefault(); setHotkeyTarget(s); }}
                      title={!enabled ? t("soundboard.disabledHint") : `${s.label} — ${s.category}${s.ttsModel ? `\n${t("tts.generatedWith", { model: TTS_MODEL_LABELS[s.ttsModel] || s.ttsModel })}` : ""}\n${t("soundboard.rightClickAssign")}${hotkey ? `\n${t("soundboard.currentHotkey", { combo: formatCombo(hotkey) })}` : ""}`}
                      style={{
                        position: 'relative',
                        border: 'none',
                        background: 'var(--sion-fond-carte-board)',
                        cursor: 'pointer', opacity: enabled ? 1 : 0.4, pointerEvents: enabled ? 'auto' : 'none',
                        transition: 'background 120ms',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-container-high)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--sion-fond-carte-board)'; }}
                    >
                        <div className="sion-board-visuel">
                          {s.emoji || '🔊'}
                        </div>
                      <div className="sion-board-description">
                        <div className="sion-carte-board-nom">{s.label}</div>
                        <div className="sion-carte-board-categorie">{subtitle}</div>
                        {s.ttsModel && (
                          <div className="sion-board-modele" style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            fontSize: 10, color: 'var(--color-outline)', marginTop: 2, minWidth: 0,
                          }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: 0.4, padding: '1px 5px',
                              borderRadius: 999, background: 'var(--color-primary)',
                              color: 'var(--color-on-primary)', flexShrink: 0,
                            }}>{t("tts.badge")}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {TTS_MODEL_LABELS[s.ttsModel] || s.ttsModel}
                            </span>
                          </div>
                        )}
                      </div>
                      {hotkey && (
                        <span className="sion-board-raccourci">{formatCombo(hotkey)}</span>
                      )}
                      {canUpload && (
                        <ActionsCarteBoard
                          modifier={{ libelle: t("soundboard.editHint"), onClick: () => setEditTarget(s) }}
                          supprimer={{ libelle: t("soundboard.deleteHint"), onClick: () => setDeleteTarget(s) }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Volume en pied de panneau. */}
          {(
            <div className="sion-pied-panneau" style={{
              padding: '8px 16px', marginTop: 'auto', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-on-surface-variant)',
            }}>
              {volumeControl}
            </div>
          )}
        </>
      )}

      {errorToast && (
        <div style={{
          position: 'absolute', bottom: 60, right: 20, padding: '8px 14px', borderRadius: 10,
          background: 'var(--color-error-container)', color: 'var(--color-error)', fontSize: 12, maxWidth: 280,
        }}>{errorToast}</div>
      )}

      {deleteTarget && (
        <ConfirmationSuppressionBoard
          titre={t("soundboard.deleteTitle", { defaultValue: "Supprimer ce son ?" })}
          description={t("soundboard.deleteConfirm", { label: deleteTarget.label })}
          messageErreur={t("soundboard.deleteError")}
          onConfirmer={() => handleDelete(deleteTarget)}
          onFermer={() => setDeleteTarget(null)}
        />
      )}

      {showUpload && roomId && (
        <SoundboardUploadModal
          existingCategories={Array.from(new Set(playable.map((s) => s.category)))}
          maxSize={SOUNDBOARD_MAX_FILE_SIZE}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); refreshRef.current(); }}
        />
      )}

      {hotkeyTarget && (
        <HotkeyCaptureModal
          eventId={hotkeyTarget.eventId}
          label={hotkeyTarget.label}
          currentCombo={hotkeys[hotkeyTarget.eventId] || null}
          onClose={() => setHotkeyTarget(null)}
        />
      )}

      {editTarget && (
        <SoundboardUploadModal
          existingCategories={Array.from(new Set(playable.map((s) => s.category)))}
          maxSize={SOUNDBOARD_MAX_FILE_SIZE}
          editing={editTarget}
          onClose={() => setEditTarget(null)}
          onUploaded={() => { setEditTarget(null); refreshRef.current(); }}
        />
      )}
    </div>
  );
}
