interface IconProps {
  className?: string;
  style?: React.CSSProperties;
}

interface MuteableIconProps extends IconProps {
  muted?: boolean;
}

export function MicIcon({ muted, className }: MuteableIconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={muted ? "var(--color-red)" : "currentColor"} className={className}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M5 10v2a7 7 0 0 0 6 6.93V21H8v2h8v-2h-3v-2.07A7 7 0 0 0 19 12v-2h-2v2a5 5 0 0 1-10 0v-2H5Z" />
      {muted && <line x1="1" y1="1" x2="23" y2="23" stroke="var(--color-red)" strokeWidth="2.5" strokeLinecap="round" />}
    </svg>
  );
}

export function HeadphoneIcon({ muted, className }: MuteableIconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={muted ? "var(--color-red)" : "currentColor"} className={className}>
      <path d="M12 2A10 10 0 0 0 2 12v7a3 3 0 0 0 3 3h1a3 3 0 0 0 3-3v-3a3 3 0 0 0-3-3H4v-1a8 8 0 0 1 16 0v1h-2a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h1a3 3 0 0 0 3-3v-7A10 10 0 0 0 12 2Z" />
      {muted && <line x1="1" y1="1" x2="23" y2="23" stroke="var(--color-red)" strokeWidth="2.5" strokeLinecap="round" />}
    </svg>
  );
}

/** Téléphone : participant connecté depuis un mobile. */
export function PhoneIcon({ className, size = 12 }: IconProps & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

export function ScreenIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M4 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7v2H7v2h10v-2h-4v-2h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4Zm0 2h16v12H4V4Z" />
    </svg>
  );
}

export function SoundboardIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="m9 5 12-3v15h-2V8l-8 2v10H9Z" />
      <ellipse cx="7" cy="19" rx="4" ry="3" />
      <ellipse cx="17" cy="16" rx="4" ry="3" />
    </svg>
  );
}

/** Visage qui pleure de rire : les traits sont évidés dans la forme pleine. */
export function MemeboardIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM5.5 8.5 9 6l1 1.5L8 9l2 1.5L9 12l-3.5-2.5v-1Zm13 0L15 6l-1 1.5L16 9l-2 1.5L15 12l3.5-2.5v-1ZM7 14h10a5 5 0 0 1-10 0Z" />
      <path d="M3 11S0 14 0 16a2 2 0 0 0 4 0c0-2-1-5-1-5Zm18 0s3 3 3 5a2 2 0 0 1-4 0c0-2 1-5 1-5Z" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z" />
    </svg>
  );
}

export function HashIcon({ className, style }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={className} style={style}>
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

/** Haut-parleur barré : son d'une personne coupé pour soi. */
export function SpeakerOffIcon({ className, style }: IconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

/** Salon d'administration du serveur. */
export function AdminRoomIcon({ className, style }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-yellow)" stroke="none" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function CrownIcon({ className }: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-orange)" stroke="none" className={className}>
      <path d="M2 20h20L19 8l-5 5-2-7-2 7-5-5z" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" className={className}>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

export function DisconnectIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-red)" strokeWidth="2.5" strokeLinecap="round" className={className}>
      <path d="M16 8l-8 8M8 8l8 8" />
    </svg>
  );
}

export function PhoneHangupIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4 16a2 2 0 0 1-2-2v-1a2 2 0 0 1 .8-1.6 16 16 0 0 1 18.4 0A2 2 0 0 1 22 13v1a2 2 0 0 1-2 2h-3a1 1 0 0 1-1-1v-2a12 12 0 0 0-8 0v2a1 1 0 0 1-1 1Z" />
    </svg>
  );
}

export function RefreshIcon({ className, style }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export function HistoryIcon({ className, style }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="M3 3v5h5" />
      <path d="M3.05 13a9 9 0 1 0 .5-5L3 8" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}

export function VideoIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M5 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H5Zm5 5v6l5-3-5-3Z" />
    </svg>
  );
}

export function PaperclipIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9h-7V2Zm2 0v5h5l-5-5Z" />
    </svg>
  );
}

export function PollIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="3" y="9" width="4" height="12" rx="1" />
      <rect x="10" y="3" width="4" height="18" rx="1" />
      <rect x="17" y="13" width="4" height="8" rx="1" />
    </svg>
  );
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function ServerIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

export function SortIcon({ className }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={className}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="16" y2="12" />
      <line x1="4" y1="18" x2="12" y2="18" />
    </svg>
  );
}

export function MessageBubbleIcon({ className }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function PencilIcon({ className, style }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

export function PinIcon({ className, filled }: IconProps & { filled?: boolean }) {
  return (
    // `filled` : épingle pleine pour un message DÉJÀ épinglé. Le contour seul
    // ne distinguait pas les deux états, et l'action étant une bascule, rien
    // n'annonçait qu'un clic désépinglerait.
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" />
    </svg>
  );
}

export function FlagIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function ReplyIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

export function EmojiIcon({ className }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7 13h10a5 5 0 0 1-10 0Z" />
    </svg>
  );
}

export function UserAddIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2Z" />
      <circle cx="9" cy="7" r="4" />
      <path d="M16 15h3a4 4 0 0 1 4 4v2h-4v-2a6 6 0 0 0-3-4ZM16 3.13a4 4 0 0 1 0 7.75 6 6 0 0 0 0-7.75Z" />
    </svg>
  );
}

/** Disposition : un grand cadre, un rail à gauche, un panneau à droite. */
export function LayoutIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="16" y1="3" x2="16" y2="21" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

interface SignalBarsIconProps extends IconProps {
  /** "excellent" | "good" | "poor" | "lost" | "unknown" */
  quality: "excellent" | "good" | "poor" | "lost" | "unknown";
  size?: number;
}

/**
 * Cellular-style signal strength bars (4 bars). The first N bars are filled
 * with a color matching the quality level, the rest are dim. "lost" shows all
 * bars in red, "unknown" shows all bars dimmed.
 */
export function SignalBarsIcon({ quality, size = 14, className, style }: SignalBarsIconProps) {
  const filledCount: number =
    quality === "excellent" ? 4 :
    quality === "good"      ? 3 :
    quality === "poor"      ? 1 :
    quality === "lost"      ? 0 :
    /* unknown */              0;

  const fillColor =
    quality === "excellent" || quality === "good" ? "var(--color-green)" :
    quality === "poor"                            ? "var(--color-yellow)" :
    quality === "lost"                            ? "var(--color-red)" :
    /* unknown */                                   "var(--color-outline)";

  const dimColor = "var(--color-outline-variant)";

  // 4 bars with growing heights inside a 16x16 viewbox
  const bars = [
    { x: 1,  y: 11, w: 2.5, h: 4 },
    { x: 5,  y: 8,  w: 2.5, h: 7 },
    { x: 9,  y: 5,  w: 2.5, h: 10 },
    { x: 13, y: 2,  w: 2.5, h: 13 },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={style}
      aria-label={`Connection quality: ${quality}`}
    >
      {bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={0.6}
          fill={i < filledCount ? fillColor : dimColor}
        />
      ))}
      {quality === "lost" && (
        // Strike-through indicator when fully lost
        <line x1="1" y1="15" x2="15" y2="1" stroke="var(--color-red)" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  );
}
