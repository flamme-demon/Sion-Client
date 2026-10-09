import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useTranscriptStore } from "../../stores/useTranscriptStore";
import { armTranscription, disarmTranscription, endSessionForAll, summarizeMeeting } from "../../services/transcriptionService";
import { backfillTranscript } from "../../services/matrixService";
import { scopeTranscriptEntries } from "../../utils/transcriptScope";
import "./TextPanel.css";

/** Stable per-identity hue (same trick as the cursor overlay) so each
 *  speaker keeps a recognizable color in the transcript. */
function colorForIdentity(identity: string): string {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = ((h << 5) - h + identity.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 65%, 60%)`;
}

function fmtTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* Stable fallbacks: `?? []` in a zustand selector would build a fresh value
 * on every store update and re-render the panel for unrelated rooms. */
const NO_ENTRIES: never[] = [];
const NO_SESSIONS: never[] = [];
const NO_SUMMARIES: Record<string, { text: string; ts: number }> = {};

/** Meeting transcript — right side panel (MemberPanel-style column),
 *  organized around the session lifecycle: the "Direct" tab shows ONE
 *  primary action matching the current state (start / join invitation /
 *  waiting / recording), and the summary/export artifacts only surface
 *  once a session is over. The "Historique" tab lists past sessions
 *  (durable Matrix events, visible to every room member). */
export function TranscriptPanel() {
  const { t } = useTranslation();
  // Le panneau latéral porte le titre et la fermeture.
  const engineState = useTranscriptStore((s) => s.state);
  const engineError = useTranscriptStore((s) => s.error);
  const downloadPct = useTranscriptStore((s) => s.downloadPct);
  const summaryState = useTranscriptStore((s) => s.summaryState);
  const summaryPct = useTranscriptStore((s) => s.summaryPct);
  const connectedVoice = useAppStore((s) => s.connectedVoiceChannel);
  const armedPeers = useTranscriptStore((s) => s.armedPeers);
  const allEntries = useTranscriptStore((s) => (connectedVoice ? s.entries[connectedVoice] : undefined) ?? NO_ENTRIES);
  const session = useTranscriptStore((s) => (connectedVoice ? s.sessions[connectedVoice] : undefined)) || null;
  const history = useTranscriptStore((s) => (connectedVoice ? s.history[connectedVoice] : undefined) ?? NO_SESSIONS);
  const summaries = useTranscriptStore((s) => (connectedVoice ? s.summaries[connectedVoice] : undefined) ?? NO_SUMMARIES);

  const [tab, setTab] = useState<"live" | "history">("live");
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exported, setExported] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Le menu doit sortir du module : une bande de 100 px ne peut pas le contenir.
  useLayoutEffect(() => {
    const menu = menuRef.current, bouton = actionsRef.current;
    if (!menuOpen || !menu || !bouton) return;
    const r = bouton.getBoundingClientRect();
    const largeur = menu.offsetWidth, hauteur = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(r.right - largeur, window.innerWidth - largeur - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(r.bottom + 4 + hauteur <= window.innerHeight - 8 ? r.bottom + 4 : r.top - hauteur - 4, window.innerHeight - hauteur - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
    const fermer = () => setMenuOpen(false);
    window.addEventListener("resize", fermer);
    const defilement = (e: Event) => { if (!(e.target instanceof Node) || !menu.contains(e.target)) fermer(); };
    window.addEventListener("scroll", defilement, true);
    return () => {
      window.removeEventListener("resize", fermer);
      window.removeEventListener("scroll", defilement, true);
      if (bouton.isConnected && (menu.contains(document.activeElement) || document.activeElement === document.body)) bouton.focus();
    };
  }, [menuOpen]);

  const viewedSession = viewedId ? history.find((h) => h.id === viewedId) || null : null;
  // One pass over the entries instead of one filter per listed session.
  const segmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of allEntries) {
      if (e.sessionId) counts.set(e.sessionId, (counts.get(e.sessionId) || 0) + 1);
    }
    return counts;
  }, [allEntries]);
  // The summary linked to the session being looked at (past or live).
  const scopedSession = viewedSession ?? session;
  const linkedSummary = scopedSession ? summaries[scopedSession.id] : undefined;
  const entries = scopeTranscriptEntries(allEntries, viewedSession, session);

  // Auto-scroll on new entries unless the user scrolled up to read back.
  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedToBottom.current && tab === "live") el.scrollTop = el.scrollHeight;
  }, [entries.length, tab]);

  // Suivre le direct quand la hauteur du module change, sans rendu React
  // à chaque pixel et sans déplacer quelqu'un qui relit un ancien passage.
  useEffect(() => {
    const el = listRef.current;
    if (!el || tab !== "live" || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, connectedVoice]);

  // Reload the transcript from the room history: a page reload wipes the
  // in-memory store and a late joiner has nothing — but every segment and
  // session event is durable in the Matrix timeline. Idempotent (store
  // dedups), bounded to the last 12 h.
  useEffect(() => {
    if (!connectedVoice) return;
    backfillTranscript(connectedVoice, Date.now() - 12 * 3600 * 1000).catch((err) => {
      console.warn("[Sion][transcribe] backfill failed:", err);
    });
  }, [connectedVoice]);

  // Back to the live tab when switching voice channel.
  useEffect(() => {
    setTab("live");
    setViewedId(null);
    setMenuOpen(false);
  }, [connectedVoice]);

  // A past session reads top-down; don't auto-stick to the bottom.
  useEffect(() => {
    setShowSummary(false);
    if (viewedId && listRef.current) {
      pinnedToBottom.current = false;
      listRef.current.scrollTop = 0;
    }
  }, [viewedId]);

  if (!connectedVoice) return null;

  const busy = engineState === "starting";
  const armed = engineState === "armed";
  const running = engineState === "on" || busy;
  const sessionActive = !!session && !session.endedAt;
  const summaryBusy = summaryState !== "idle";
  // The local engines live in the Rust backend — web/mobile builds still SEE
  // everyone's transcript (it arrives over Matrix) but can't feed/summarize.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canTranscribe = typeof (globalThis as any).__TAURI_INTERNALS__ !== "undefined";
  const micCount = armedPeers.length + (running || armed ? 1 : 0);

  const openHistoryTab = () => {
    setTab("history");
    setViewedId(null);
    setHistLoading(true);
    // Deep backfill: sessions live in the durable timeline, go look for
    // them (bounded: 30 days / 40 pages).
    backfillTranscript(connectedVoice, Date.now() - 30 * 24 * 3600 * 1000, 40)
      .catch((err) => console.warn("[Sion][transcribe] history backfill failed:", err))
      .finally(() => setHistLoading(false));
  };

  const handleArm = () => {
    armTranscription(connectedVoice).catch((err) => {
      console.error("[Sion][transcribe] arm failed:", err);
      useTranscriptStore.getState().setState("error", String(err?.message || err));
    });
  };

  const handleStopMine = () => disarmTranscription(connectedVoice);

  const handleEndForAll = () => {
    endSessionForAll(connectedVoice).catch((err) => {
      console.error("[Sion][transcribe] end-for-all failed:", err);
    });
  };

  const handleSummarize = () => {
    setSummaryError(null);
    summarizeMeeting(connectedVoice, viewedSession?.id).catch((err) => {
      console.error("[Sion][summary] failed:", err);
      setSummaryError(String(err?.message || err));
    });
  };

  const handleExport = async () => {
    if (!entries.length) return;
    const channelName = useMatrixStore.getState().channels.find((c) => c.id === connectedVoice)?.name || "reunion";
    const refDate = viewedSession ? new Date(viewedSession.ts) : new Date();
    const lines = entries.map((e) => `- **${e.senderName}** (${fmtTime(e.t0)}) : ${e.text}`);
    const md = `# ${t("transcript.exportTitle", { defaultValue: "Transcription" })} — ${channelName} — ${refDate.toLocaleDateString()}\n\n${lines.join("\n")}\n`;
    const file = new File([md], `transcript-${channelName}-${refDate.toISOString().slice(0, 10)}.md`, { type: "text/markdown" });
    try {
      await useMatrixStore.getState().sendFile(connectedVoice, file);
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (err) {
      console.error("[Sion][transcribe] export failed:", err);
    }
  };


  const primaryBtn = (label: string, onClick: () => void, opts?: { disabled?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={opts?.disabled}
      style={{
        width: '100%', padding: '9px 12px', borderRadius: 10, border: 'none',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
        cursor: opts?.disabled ? 'default' : 'pointer',
        opacity: opts?.disabled ? 0.55 : 1,
        background: 'var(--color-primary)', color: 'var(--color-on-primary)',
      }}
    >{label}</button>
  );

  const smallBtn = (label: string, onClick: () => void, opts?: { danger?: boolean; disabled?: boolean; title?: string; grow?: boolean; menu?: boolean }) => (
    <button
      type="button"
      role={opts?.menu ? "menuitem" : undefined}
      onClick={onClick}
      disabled={opts?.disabled}
      title={opts?.title}
      style={{
        flex: opts?.grow ? 1 : undefined,
        width: opts?.grow ? undefined : '100%',
        padding: '7px 10px', borderRadius: 8, border: 'none',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
        cursor: opts?.disabled ? 'default' : 'pointer',
        opacity: opts?.disabled ? 0.55 : 1,
        background: opts?.danger ? 'var(--color-error-container)' : 'var(--color-surface-container-highest)',
        color: opts?.danger ? 'var(--color-error)' : 'var(--color-on-surface)',
        transition: 'background 150ms',
      }}
    >{label}</button>
  );

  /** Summary / export actions — surfaced once there is something to act on. */
  const artifactsFooter = (
    <div className="sion-transcript-artefacts">
      {!viewedSession && session?.endedAt != null && (
        <div style={{ fontSize: 11, color: 'var(--color-on-surface-variant)' }}>
          ✓ {t("transcript.sessionEnded", { time: fmtTime(session.endedAt), defaultValue: "Session terminée à {{time}}" })}
        </div>
      )}
      {linkedSummary && smallBtn(
        showSummary
          ? t("transcript.hideSummary", { defaultValue: "Masquer le résumé" })
          : t("transcript.viewSummary", { defaultValue: "Voir le résumé" }),
        () => setShowSummary((v) => !v),
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        {canTranscribe && smallBtn(
          summaryState === "downloading"
            ? `${t("transcript.summaryDownloading", { defaultValue: "Téléchargement IA…" })} ${summaryPct ?? 0}%`
            : summaryState === "running"
              ? t("transcript.summarizing", { defaultValue: "Résumé en cours…" })
              : t("transcript.summarize", { defaultValue: "Résumer" }),
          handleSummarize,
          { grow: true, disabled: summaryBusy || !entries.length, title: t("transcript.summarizeHint", { defaultValue: "Génère un compte-rendu (IA locale) et le poste dans le chat" }) },
        )}
        {smallBtn(
          exported ? "✓" : t("transcript.export", { defaultValue: "Exporter .md" }),
          handleExport,
          { grow: true, disabled: !entries.length, title: t("transcript.exportHint", { defaultValue: "Envoie le transcript en .md dans le chat" }) },
        )}
      </div>
      {summaryError && (
        <div style={{ fontSize: 11, color: 'var(--color-error)' }}>{summaryError}</div>
      )}
    </div>
  );

  const transcriptList = (
    <div
      ref={listRef}
      className="sion-transcript-liste"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {showSummary && linkedSummary && (
        <div className="sion-transcript-resume">
          {linkedSummary.text}
        </div>
      )}
      {entries.length === 0 ? (
        <div style={{ paddingTop: 8, fontSize: 12, color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
          {viewedSession
            ? t("transcript.sessionNoSegments", { defaultValue: "Aucun segment retrouvé pour cette session." })
            : t("transcript.empty", { defaultValue: "Aucun segment pour l'instant." })}
        </div>
      ) : (
        entries.map((e) => (
          <div key={e.id} className="sion-transcript-segment">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ color: colorForIdentity(e.senderId), fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.senderName}</span>
              <span style={{ color: 'var(--color-outline)', fontSize: 10, flexShrink: 0 }}>{fmtTime(e.t0)}</span>
            </div>
            <div className="sion-transcript-texte">{e.text}</div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="sion-transcript">
      <div className="sion-transcript-outils">
      {/* Header */}
      <div className="sion-transcript-entete">
        {/* Tabs */}
        <div className="sion-transcript-onglets">
          <button type="button" aria-pressed={tab === "live"} onClick={() => { pinnedToBottom.current = true; setTab("live"); setViewedId(null); }}>
            {t("transcript.tabLive", { defaultValue: "Direct" })}
          </button>
          <button type="button" aria-pressed={tab === "history"} onClick={openHistoryTab}>
            {t("transcript.tabHistory", { defaultValue: "Historique" })}
          </button>
        </div>
      </div>

      {tab === "live" ? (
          /* State zone — one primary action per lifecycle state. */
          <div className="sion-transcript-etat">
            {sessionActive ? (
              <div className="sion-transcript-session-active" style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-error)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--color-on-surface)', flex: 1, minWidth: 0 }}>
                  {t("transcript.sessionSince", { time: fmtTime(session!.ts), defaultValue: "Session depuis {{time}}" })}
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--color-on-surface-variant)' }}>
                    {t("transcript.micCount", { count: micCount, defaultValue: "{{count}} micros actifs" })}
                    {!running && !armed ? ` · ${t("transcript.notTranscribing", { defaultValue: "votre micro n'est pas transcrit" })}` : ""}
                  </span>
                </span>
                {canTranscribe && (
                  <button
                    type="button"
                    ref={actionsRef}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}
                    title={t("transcript.sessionActions", { defaultValue: "Actions de session" })}
                    style={{ border: 'none', background: 'transparent', color: 'var(--color-on-surface-variant)', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                  >⋯</button>
                )}
                {menuOpen && (
                  createPortal(<>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} onClick={() => setMenuOpen(false)} />
                    <div ref={menuRef} role="menu" aria-label={t("transcript.sessionActions", { defaultValue: "Actions de session" })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.stopPropagation(); setMenuOpen(false); }
                        if (e.key === "Tab") setMenuOpen(false);
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const boutons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                          const index = boutons.indexOf(document.activeElement as HTMLButtonElement);
                          boutons[(index + (e.key === "ArrowDown" ? 1 : -1) + boutons.length) % boutons.length]?.focus();
                        }
                      }} style={{
                      position: 'fixed', zIndex: 1001,
                      background: 'var(--color-surface-container-high)', borderRadius: 10,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.35)', padding: 4, minWidth: 180,
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                      {smallBtn(
                        running
                          ? t("transcript.stopMine", { defaultValue: "Arrêter mon micro" })
                          : t("transcript.startMine", { defaultValue: "Transcrire mon micro" }),
                        () => { setMenuOpen(false); if (running) handleStopMine(); else handleArm(); },
                        { disabled: busy, menu: true },
                      )}
                      {smallBtn(
                        t("transcript.endForAll", { defaultValue: "Terminer pour tous" }),
                        () => { setMenuOpen(false); handleEndForAll(); },
                        { danger: true, menu: true, title: t("transcript.endForAllHint", { defaultValue: "Met fin à la session de transcription pour tous les participants" }) },
                      )}
                    </div>
                  </>, document.body)
                )}
              </div>
            ) : armed ? (
              <>
                <div style={{ fontSize: 12, lineHeight: 1.45, padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface-container-high)', color: 'var(--color-on-surface-variant)' }}>
                  {t("transcript.waitingPeer", { defaultValue: "La transcription démarrera quand un 2e participant cliquera « Participer »." })}
                </div>
                {smallBtn(t("transcript.cancel", { defaultValue: "Annuler" }), handleStopMine, { danger: true })}
              </>
            ) : (
              <>
                {armedPeers.length > 0 && (
                  <div style={{
                    fontSize: 12, lineHeight: 1.45, padding: '8px 10px', borderRadius: 8,
                    background: 'var(--color-secondary-container)', color: 'var(--color-on-secondary-container)',
                  }}>
                    {t("transcript.invitation", {
                      name: armedPeers.map((p) => p.name).join(", "),
                      defaultValue: "{{name}} souhaite lancer la transcription.",
                    })}
                  </div>
                )}
                {canTranscribe && primaryBtn(
                  armedPeers.length > 0
                    ? t("transcript.joinInvite", { defaultValue: "Rejoindre la transcription" })
                    : t("transcript.start", { defaultValue: "Démarrer la transcription" }),
                  handleArm,
                  { disabled: busy },
                )}
                {canTranscribe && armedPeers.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--color-on-surface-variant)', lineHeight: 1.4 }}>
                    {t("transcript.startHint", { defaultValue: "Démarre dès que deux participants l'ont activée — chacun transcrit sa propre voix, localement." })}
                  </div>
                )}
              </>
            )}
            {downloadPct != null && downloadPct < 100 && (
              <div style={{ fontSize: 11, color: 'var(--color-on-surface-variant)' }}>
                {t("transcript.downloading", { defaultValue: "téléchargement du modèle…" })} {downloadPct}%
              </div>
            )}
            {engineState === "error" && engineError && (
              <div style={{ fontSize: 11, color: 'var(--color-error)' }}>{engineError}</div>
            )}
          </div>

      ) : viewedSession ? (
          /* One past session */
          <div className="sion-transcript-etat">
            {smallBtn(`← ${t("transcript.backToSessions", { defaultValue: "Toutes les sessions" })}`, () => setViewedId(null))}
            <div style={{ fontSize: 11, color: 'var(--color-on-surface-variant)' }}>
              {new Date(viewedSession.ts).toLocaleDateString()} · {fmtTime(viewedSession.ts)}
              {viewedSession.endedAt != null ? `–${fmtTime(viewedSession.endedAt)}` : ""}
            </div>
          </div>
      ) : null}
      {/* Les artefacts restent en pied dans une colonne et rejoignent les
          commandes quand le module occupe une bande horizontale. */}
      {(viewedSession || (tab === "live" && entries.length > 0 && !sessionActive)) && artifactsFooter}
      </div>

      {tab === "live" || viewedSession ? transcriptList : (
        /* Session list */
        <div className="sion-transcript-historique" onWheel={(e) => {
          if (getComputedStyle(e.currentTarget).overflowY === "hidden") e.currentTarget.scrollLeft += e.deltaY;
        }}>
          {histLoading && (
            <div style={{ padding: '6px 0', fontSize: 12, color: 'var(--color-on-surface-variant)' }}>
              {t("transcript.historyLoading", { defaultValue: "Recherche des sessions…" })}
            </div>
          )}
          {!histLoading && history.length === 0 ? (
            <div style={{ paddingTop: 8, fontSize: 12, color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
              {t("transcript.historyEmpty", { defaultValue: "Aucune session de transcription trouvée dans les 30 derniers jours." })}
            </div>
          ) : (
            history.map((h) => {
              const count = segmentCounts.get(h.id) || 0;
              const ongoing = h.endedAt == null && session?.id === h.id && sessionActive;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setViewedId(h.id)}
                  className="sion-transcript-session"
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {new Date(h.ts).toLocaleDateString()} · {fmtTime(h.ts)}
                      {h.endedAt != null
                        ? `–${fmtTime(h.endedAt)}`
                        : ongoing
                          ? ` · ${t("transcript.sessionOngoing", { defaultValue: "en cours" })}`
                          : ""}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-on-surface-variant)', marginTop: 2 }}>
                      {t("transcript.segmentCount", { count, defaultValue: "{{count}} segments" })}
                      {h.startedBy ? ` · ${h.startedBy.replace(/^@/, "").split(":")[0]}` : ""}
                    </div>
                  </div>
                  {summaries[h.id] && (
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
                      {t("transcript.summaryAvailable", { defaultValue: "résumé" })}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
