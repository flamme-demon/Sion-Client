import { useEspacesStore } from "../../stores/useEspacesStore";
import { salonsDansEspace } from "../../utils/espaces";
import { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import { useSettingsStore, type ChannelSortMode } from "../../stores/useSettingsStore";
import { SortIcon } from "../icons";
import { NavigationEspaces } from "./NavigationEspaces";
import { useIsMobile } from "../../hooks/useIsMobile";
import { ChannelItem } from "./ChannelItem";
import { MatrixRain, MATRIX_GREEN } from "./MatrixRain";

const SORT_OPTIONS: ChannelSortMode[] = ["created", "name", "activity"];

const SORT_KEYS: Record<ChannelSortMode, string> = {
  created: "channels.sortCreated",
  name: "channels.sortName",
  activity: "channels.sortActivity",
};

export function ChannelList({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const channels = useMatrixStore((s) => s.channels);
  const espaceActif = useEspacesStore((s) => s.espaceActif);
  const connectingVoice = useAppStore((s) => s.connectingVoiceChannel);
  const channelSort = useSettingsStore((s) => s.channelSort);
  const setChannelSort = useSettingsStore((s) => s.setChannelSort);
  const sidebarView = useSettingsStore((s) => s.sidebarView);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const sortedChannels = useMemo(() => {
    // Show all DM rooms, including duplicates — hiding them would mask the
    // fact that a peer posted in a different room than the one the user is
    // watching (leading to "the message disappeared" confusion). Duplicates
    // are cleaned up via the admin-side "Nettoyer MP dupliqués" action.
    const filtered = sidebarView === "dm" ? channels.filter((ch) => ch.isDM && !ch.isSpace && !ch.isSoundboard)
      : salonsDansEspace(channels, espaceActif);
    const copy = [...filtered];
    switch (channelSort) {
      case "created":
        return copy.sort((a, b) => a.createdAt - b.createdAt);
      case "name":
        return copy.sort((a, b) => a.name.localeCompare(b.name));
      case "activity":
        return copy.sort((a, b) => b.lastActivity - a.lastActivity);
      default:
        return copy;
    }
  }, [channels, channelSort, sidebarView, espaceActif]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: compact ? '4px 6px' : '4px 12px' }}>
      {/* Sur téléphone, les espaces restent dans la liste ; desktop utilise le rail. */}
      {(isMobile || !compact) && <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px' }}>
        {isMobile && <NavigationEspaces />}
        {!isMobile && <span className="sion-titre" style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>{t(sidebarView === "dm" ? "channels.tabDM" : "layout.channels")}</span>}
        {!compact && (
        <div ref={menuRef} style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title={t(SORT_KEYS[channelSort])}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: menuOpen ? 'var(--color-accent)' : 'var(--color-on-surface-variant)',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent)')}
            onMouseLeave={(e) => { if (!menuOpen) e.currentTarget.style.color = 'var(--color-on-surface-variant)'; }}
          >
            <SortIcon />
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: 'var(--color-surface-container)',
              border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
              borderRadius: 6,
              padding: '4px 0',
              minWidth: 160,
              zIndex: 50,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {SORT_OPTIONS.map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setChannelSort(mode); setMenuOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: channelSort === mode ? 'var(--color-accent)' : 'var(--color-on-surface)',
                    fontSize: 12,
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ width: 16, textAlign: 'center', fontSize: 13 }}>
                    {channelSort === mode ? "✓" : ""}
                  </span>
                  {t(SORT_KEYS[mode])}
                </button>
              ))}
            </div>
          )}
        </div>
        )}
      </div>}
      {connectingVoice ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden', borderRadius: 12,
          minHeight: 200,
        }}>
          <MatrixRain width={compact ? 52 : 236} height={200} />
          {!compact && (
          <div style={{
            position: 'absolute', bottom: 16,
            fontSize: 12, fontWeight: 600, color: MATRIX_GREEN,
            textShadow: '0 0 8px rgba(0,255,70,0.6)',
            letterSpacing: '0.1em',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}>
            {t("voice.connecting")}
          </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sortedChannels.map((ch) => (
            <ChannelItem key={ch.id} channel={ch} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}
