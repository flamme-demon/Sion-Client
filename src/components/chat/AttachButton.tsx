import { useRef, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { PaperclipIcon, FileIcon, PollIcon, VideoIcon } from "../icons";
import { useAppStore } from "../../stores/useAppStore";
import { PollCreateModal } from "./PollCreateModal";
import { SUR_ANDROID } from "../../utils/plateforme";

// Import de vidéo externe (yt-dlp & co) hors du chunk de démarrage (perf
// mémoire, 2026-09-12) : chargé à l'ouverture de l'importeur seulement.
const ExternalVideoImport = lazy(() =>
  import("./ExternalVideoImport").then((m) => ({ default: m.ExternalVideoImport })),
);

export function AttachButton({ action = "menu", disabled = false }: { action?: "menu" | "file" | "video" | "poll"; disabled?: boolean }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const addPendingFile = useAppStore((s) => s.addPendingFile);
  const activeChannel = useAppStore((s) => s.activeChannel);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [showVideoImport, setShowVideoImport] = useState(false);
  const menu = action === "menu";
  const label = t(action === "video" ? "extVideo.menuItem" : action === "poll" ? "poll.menuItem" : "chat.attachFile");
  const buttonDisabled = disabled || (action === "poll" && !activeChannel);

  const ouvrir = () => {
    if (action === "file") inputRef.current?.click();
    else if (action === "video") setShowVideoImport(true);
    else if (action === "poll") setShowPoll(true);
    else setMenuOpen((o) => !o);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) addPendingFile(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
    border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8,
    padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', color: 'var(--color-on-surface)',
  };

  if (action === "video" && SUR_ANDROID) return null;

  return (
    <>
      <div
        style={{ position: 'relative', display: 'flex' }}
        onMouseEnter={() => { if (menu && !disabled) setMenuOpen(true); }}
        onMouseLeave={() => setMenuOpen(false)}
      >
        <button
          type="button"
          disabled={buttonDisabled}
          aria-label={label}
          aria-expanded={menu ? menuOpen : undefined}
          onClick={ouvrir}
          style={{ background: 'transparent', border: 'none', cursor: buttonDisabled ? 'default' : 'pointer', opacity: buttonDisabled ? 0.4 : 1, padding: menu ? 10 : 7, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: menu ? '50%' : 8, color: 'var(--color-on-surface-variant)', transition: 'background 200ms' }}
          title={label}
        >
          {action === "video" ? <VideoIcon /> : action === "poll" ? <PollIcon /> : <PaperclipIcon />}
        </button>
        {(menu || action === "file") && <input ref={inputRef} type="file" multiple style={{ display: 'none' }} onChange={handleChange} />}

        {menuOpen && (
          // paddingBottom acts as an invisible bridge so the cursor can travel from
          // the paperclip into the menu without crossing a gap that closes it.
          <div style={{ position: 'absolute', bottom: '100%', left: 0, paddingBottom: 8, zIndex: 51 }}>
            <div style={{ background: 'var(--color-surface-container-high)', border: '1px solid var(--color-outline-variant)', borderRadius: 12, padding: 6, minWidth: 190, boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}>
              <button type="button" style={itemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-container-highest)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => { setMenuOpen(false); inputRef.current?.click(); }}>
                <FileIcon /> {t("chat.attachFileItem")}
              </button>
              {/* Vidéo par lien (yt-dlp) : pas sur téléphone. */}
              {!SUR_ANDROID && <button type="button" style={itemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-container-highest)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => { setMenuOpen(false); setShowVideoImport(true); }}>
                <VideoIcon /> {t("extVideo.menuItem")}
              </button>}
              <button type="button" style={itemStyle} disabled={!activeChannel}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-container-highest)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => { setMenuOpen(false); setShowPoll(true); }}>
                <PollIcon /> {t("poll.menuItem")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HORS du bloc de survol, et c'est tout le sujet. Ces fenêtres ont un
          fond plein écran : rendues dedans, tout l'écran devenait « le
          trombone ». Le menu se rouvrait au moindre mouvement sur la fenêtre,
          puis ne se refermait plus — la souris n'en sortait jamais — et restait
          posé sur l'aperçu du fichier qu'on venait d'importer (22/09). */}
      {showPoll && activeChannel && <PollCreateModal roomId={activeChannel} onClose={() => setShowPoll(false)} />}
      {showVideoImport && (
        <Suspense fallback={null}>
          <ExternalVideoImport
            onClose={() => setShowVideoImport(false)}
            onImported={(file) => { addPendingFile(file); setShowVideoImport(false); }}
          />
        </Suspense>
      )}
    </>
  );
}
