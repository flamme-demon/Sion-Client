import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MicIcon, HeadphoneIcon, DisconnectIcon, SettingsIcon, RefreshIcon, SignalBarsIcon } from "../icons";
import { useLiveKitStore } from "../../stores/useLiveKitStore";
import { estCetAppareil } from "../../utils/identiteVocale";
import { useLatence } from "../../hooks/useLatence";
import { CarteReconnexion } from "./CarteReconnexion";
import { UserAvatar } from "./UserAvatar";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useVoiceChannel, republishVoicePresence } from "../../hooks/useVoiceChannel";
import { useTranscriptStore } from "../../stores/useTranscriptStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { preloadHeavyScreens } from "../../services/lazyScreens";

/** "CC" captions glyph for the transcript toggle — drawn inline (the icons
 *  module has no captions icon) and tinted green while OUR engine runs. */
function TranscriptIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={active ? { color: 'var(--color-green)' } : undefined}>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M10.5 10.2a2.4 2.4 0 0 0-3.4 0 2.7 2.7 0 0 0 0 3.6 2.4 2.4 0 0 0 3.4 0" />
      <path d="M17 10.2a2.4 2.4 0 0 0-3.4 0 2.7 2.7 0 0 0 0 3.6 2.4 2.4 0 0 0 3.4 0" />
    </svg>
  );
}

export function CarteProfil({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const isMuted = useAppStore((s) => s.isMuted);
  const isDeafened = useAppStore((s) => s.isDeafened);
  const toggleMute = useAppStore((s) => s.toggleMute);
  const toggleDeafen = useAppStore((s) => s.toggleDeafen);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const showSettings = useAppStore((s) => s.showSettings);
  const toggleAccountPanel = useAppStore((s) => s.toggleAccountPanel);
  const connectedVoice = useAppStore((s) => s.connectedVoiceChannel);
  const channels = useMatrixStore((s) => s.channels);
  const credentials = useAuthStore((s) => s.credentials);
  const e2eeUnhealthy = useAppStore((s) => s.e2eeUnhealthy);
  const latence = useLatence(!!connectedVoice);
  // Qualité de NOTRE connexion, telle que la juge le serveur vocal.
  const qualiteLocale = useLiveKitStore(
    (s) => s.participants.find((p) => estCetAppareil(p.identity, credentials?.userId, credentials?.deviceId))?.connectionQuality,
  );
  const clockSkewMin = useAppStore((s) => s.clockSkewMin);
  const setE2EEUnhealthy = useAppStore((s) => s.setE2EEUnhealthy);
  const { leaveVoiceChannel } = useVoiceChannel();
  const transcriptPanelOpen = useLayoutStore((s) => s.panneau === "transcript");
  const transcriptState = useTranscriptStore((s) => s.state);
  const transcriptInvites = useTranscriptStore((s) => s.armedPeers.length);
  // Brief "done" feedback after the user hits the republish-presence recovery.
  const [republished, setRepublished] = useState(false);

  const handleRepublish = async () => {
    await republishVoicePresence();
    // Optimistically clear the unhealthy flag — if E2EE is still broken a new
    // MissingKey error re-raises it within seconds.
    setE2EEUnhealthy(false);
    setRepublished(true);
    setTimeout(() => setRepublished(false), 2000);
  };

  const displayName = credentials?.displayName || credentials?.userId || "User";
  const avatarUrl = credentials?.avatarUrl;
  const activeVoice = channels.find((c) => c.id === connectedVoice);
  const inVoice = !!connectedVoice;
  const audioBouton = (active: boolean) => ({
    border: 'none', background: active ? 'var(--color-error-container)' : 'transparent',
    color: active ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
    borderRadius: 10, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const raccrocher = inVoice && <button type="button" aria-label={t("voice.disconnect")} title={t("voice.disconnect")}
    onClick={() => leaveVoiceChannel(connectedVoice!)} style={{ ...audioBouton(true), marginLeft: compact ? 0 : 'auto' }}><DisconnectIcon /></button>;
  return (
    <div className="sion-carte-profil" style={{ padding: compact ? '14px 8px' : '14px 14px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-container)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button type="button" data-panel-toggle aria-label={t("settings.account")} onClick={toggleAccountPanel}
        title={displayName} style={{ display: 'flex', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', gap: 10, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: 'var(--color-on-surface)', textAlign: 'left', fontFamily: 'inherit', minWidth: 0 }}>
        <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <UserAvatar name={displayName} speaking={false} size="md" avatarUrl={avatarUrl} />
          <span style={{ position: 'absolute', right: 0, bottom: 0, width: 10, height: 10, borderRadius: '50%', background: 'var(--color-green)', border: '2px solid var(--color-surface-container)' }} />
        </span>
        {!compact && <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
          <span style={{ display: 'block', fontSize: 10, marginTop: 3, color: 'var(--color-on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inVoice ? activeVoice?.name || t("voice.connected") : t("server.online")}</span>
        </span>}
      </button>
      <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: 4 }}>
        <button type="button" onClick={() => toggleMute()} aria-pressed={isMuted} aria-label={isMuted ? t("controls.unmute") : t("controls.mute")} title={isMuted ? t("controls.unmute") : t("controls.mute")} style={audioBouton(isMuted)}><MicIcon muted={isMuted} /></button>
        <button type="button" onClick={toggleDeafen} aria-pressed={isDeafened} aria-label={isDeafened ? t("controls.undeafen") : t("controls.deafen")} title={isDeafened ? t("controls.undeafen") : t("controls.deafen")} style={audioBouton(isDeafened)}><HeadphoneIcon muted={isDeafened} /></button>
        {!compact && <button type="button" data-panel-toggle onClick={toggleSettings} onPointerEnter={() => preloadHeavyScreens(0)} aria-label={t("settings.title")} title={t("settings.title")} aria-pressed={showSettings} style={audioBouton(false)}><SettingsIcon /></button>}
        {raccrocher}
      </div>
      {!compact && <>
        {clockSkewMin !== 0 && <div style={{ fontSize: 11, color: 'var(--color-error)' }}>{t("voice.clockSkew", { minutes: Math.abs(clockSkewMin) })}</div>}
        {!inVoice && <CarteReconnexion />}
        {inVoice && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-on-surface-variant)', fontSize: 10 }}>
          {qualiteLocale && qualiteLocale !== 'unknown' && <SignalBarsIcon quality={qualiteLocale} size={13} />}
          {latence != null && <span>{latence} ms</span>}
          {(e2eeUnhealthy || republished) && <button type="button" onClick={handleRepublish} aria-label={t("voice.republishPresence")} title={t("voice.republishPresence")} style={audioBouton(e2eeUnhealthy)}><RefreshIcon /></button>}
          <button type="button" onClick={() => useLayoutStore.getState().basculerPanneau("transcript")} aria-label={t("transcript.togglePanel")} title={t("transcript.togglePanel")} aria-pressed={transcriptPanelOpen}
            style={{ ...audioBouton(false), marginLeft: 'auto', color: transcriptPanelOpen ? 'var(--color-primary)' : 'var(--color-on-surface-variant)' }}>
            <TranscriptIcon active={transcriptState === 'on'} />
            {transcriptInvites > 0 && <span style={{ fontSize: 10, marginLeft: 4 }}>{transcriptInvites}</span>}
          </button>
        </div>}
      </>}
    </div>
  );
}
