import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  uploadSound,
  editSound,
  playSoundLocal,
  SOUND_GAIN_MIN,
  SOUND_GAIN_MAX,
  SOUND_GAIN_DEFAULT,
  type SoundEntry,
} from "../../services/soundboardService";
import { AudioTrimmer } from "./AudioTrimmer";
import { ExternalAudioImport } from "./ExternalAudioImport";
import { EmojiGridPanel } from "./EmojiGridPanel";
import { trimToClip } from "../../services/audioTrim";
import { TTS_MODEL_LABELS } from "../../services/ttsService";
import { SUR_ANDROID } from "../../utils/plateforme";
import {
  FOND_IMPORT_BOARD as FOND,
  CARTE_IMPORT_BOARD as CARTE,
  CHAMP_IMPORT_BOARD as CHAMP,
  styleBoutonImportBoard as styleBouton,
} from "./boardImportStyles";

/** Hauteur du sélecteur d'emoji, et marge qui le sépare du bouton. */
const EMOJI_PANEL_H = 300;
const EMOJI_PANEL_GAP = 8;

// Soundboard sounds are capped at 20s; the trimmer cuts longer files down to a
// chosen ≤20s window + re-encodes to opus, so the input file can be large even
// though the uploaded clip must stay under `maxSize`. Cap the input only to
// avoid decoding absurdly large files into memory.
const MAX_INPUT_SIZE = 30 * 1024 * 1024; // 30 MB
const MAX_CLIP_SEC = 20;

interface Props {
  existingCategories: string[];
  maxSize: number;
  onClose: () => void;
  onUploaded: () => void;
  /** If provided, the modal acts as an editor for this existing sound. */
  editing?: SoundEntry | null;
}

export function SoundboardUploadModal({ existingCategories, maxSize, onClose, onUploaded, editing = null }: Props) {
  const { t } = useTranslation();
  const titreId = useId();
  const titreLienId = useId();
  const categoriesId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"file" | "url">("file");
  const [label, setLabel] = useState(editing?.label || "");
  const [category, setCategory] = useState(editing?.category || "");
  const [emoji, setEmoji] = useState(editing?.emoji || "");
  const [gain, setGain] = useState<number>(editing?.gain ?? SOUND_GAIN_DEFAULT);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiRowRef = useRef<HTMLDivElement>(null);
  const [pickerBox, setPickerBox] = useState<{ left: number; top: number; width: number } | null>(null);

  /**
   * Ancre le sélecteur d'emoji dans le repère de la fenêtre.
   *
   * Le modal défile désormais et rogne ce qui déborde, donc un panneau en
   * `absolute` y serait coupé — c'est exactement le symptôme signalé. En
   * `fixed`, il échappe au rognage ; en contrepartie sa position doit être
   * calculée à la main, et recalculée quand le modal défile.
   *
   * Il s'ouvre sous le bouton, ou au-dessus quand la place manque.
   */
  const placePicker = () => {
    const r = emojiRowRef.current?.getBoundingClientRect();
    if (!r) return;
    const roomBelow = window.innerHeight - r.bottom - EMOJI_PANEL_GAP;
    const top =
      roomBelow >= EMOJI_PANEL_H
        ? r.bottom + EMOJI_PANEL_GAP
        : Math.max(EMOJI_PANEL_GAP, r.top - EMOJI_PANEL_H - EMOJI_PANEL_GAP);
    const width = Math.min(320, window.innerWidth - EMOJI_PANEL_GAP * 2);
    const left = Math.max(EMOJI_PANEL_GAP, Math.min(r.left, window.innerWidth - width - EMOJI_PANEL_GAP));
    setPickerBox({ left, top, width });
  };

  // Le modal défile sous un panneau `fixed`, qui resterait sinon collé à
  // l'écran pendant que son bouton s'en va. `capture` est indispensable : le
  // défilement du modal ne remonte pas jusqu'à la fenêtre.
  useEffect(() => {
    if (!showEmojiPicker) return;
    const onMove = () => placePicker();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [showEmojiPicker]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Current trim selection + decoded buffer, reported by <AudioTrimmer>.
  const regionRef = useRef<{ start: number; end: number; buffer: AudioBuffer } | null>(null);

  // Revoke the preview blob URL when the modal unmounts — leaving it alive
  // holds the File in memory until GC, which never runs on inactive tabs.
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handleFile = (f: File) => {
    setError(null);
    if (!f.type.startsWith("audio/")) {
      setError(t("soundboard.errorNotAudio"));
      return;
    }
    // The input can be larger than the upload cap — we trim + re-encode below.
    // Only reject truly huge files to protect decodeAudioData's memory use.
    if (f.size > MAX_INPUT_SIZE) {
      setError(`Fichier trop lourd (max ${Math.round(MAX_INPUT_SIZE / 1024 / 1024)} MB)`);
      return;
    }
    regionRef.current = null;
    setFile(f);
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, "").slice(0, 60));
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    if (!label.trim() || busy) return;
    if (!editing && !file) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await editSound(editing, label.trim(), category.trim() || "Autre", emoji.trim() || null, gain);
      } else if (file) {
        let toUpload = file;
        const r = regionRef.current;
        if (r) {
          // Trim+re-encode unless the file is already a small, full-length
          // ≤20s clip (then keep the original to preserve its quality/format).
          const isFullFile = r.start <= 0.05 && Math.abs(r.end - r.buffer.duration) < 0.05;
          const needsTrim = !isFullFile || r.buffer.duration > MAX_CLIP_SEC + 0.05 || file.size > maxSize;
          if (needsTrim) {
            const end = Math.min(r.end, r.start + MAX_CLIP_SEC);
            toUpload = await trimToClip(r.buffer, r.start, end, file.name);
          }
        }
        await uploadSound(toUpload, label.trim(), category.trim() || "Autre", emoji.trim() || null, gain);
      }
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const peutEnvoyer = (!!editing || !!file) && !!label.trim() && !busy;

  // Le portail sort la fenêtre des modules qui utilisent `contain: strict`.
  // Le fond ne ferme pas l'éditeur : on conserve la source et le découpage.
  return createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ ...FOND, zIndex: 10000 }}
    >
      <div
        role="dialog"
        aria-modal={mode !== "url"}
        aria-labelledby={titreId}
        inert={mode === "url"}
        style={{ ...CARTE, width: 560, maxHeight: 'calc(100dvh - 32px)', overflow: 'hidden' }}
      >
        <div id={titreId} className="sion-titre" style={{ flexShrink: 0, fontSize: 16, fontWeight: 700 }}>
          {editing ? t("soundboard.editTitle") : t("soundboard.uploadTitle")}
        </div>

        <div className="sion-board-import-corps" style={{ minHeight: 0, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!editing && (
              <>
                <div style={{ fontSize: 12, color: 'var(--color-on-surface-variant)' }}>{t("soundboard.limits")}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <button type="button" style={styleBouton(false)} onClick={() => fileInputRef.current?.click()}>
                    {t("soundboard.modeFile")}
                  </button>
                  {!SUR_ANDROID && (
                    <button type="button" style={styleBouton(false)} onClick={() => { setShowEmojiPicker(false); setMode("url"); }}>
                      {t("soundboard.modeUrl")}
                    </button>
                  )}
                  {file && (
                    <span title={file.name} style={{ minWidth: 0, fontSize: 12, color: 'var(--color-on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </span>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                  />
                </div>
              </>
            )}

            {(editing || file) && (
              <>
                <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                  <label style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    {t("soundboard.label")}
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder={t("soundboard.labelPlaceholder")}
                      maxLength={60}
                      style={CHAMP}
                    />
                  </label>
                  <div ref={emojiRowRef} style={{ fontSize: 12, display: 'flex', flexDirection: 'column' }}>
                    {t("soundboard.emoji")}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => { if (!showEmojiPicker) placePicker(); setShowEmojiPicker((v) => !v); }}
                        title={t("soundboard.emoji")}
                        aria-expanded={showEmojiPicker}
                        style={{
                          width: 38, height: 36, borderRadius: 10, border: '1px solid var(--color-outline-variant)',
                          background: 'var(--color-surface-container)', color: 'var(--color-on-surface)',
                          fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >{emoji || "🔊"}</button>
                      {emoji && (
                        <button
                          type="button"
                          onClick={() => setEmoji("")}
                          title={t("soundboard.emojiClear")}
                          style={{ border: 'none', background: 'transparent', color: 'var(--color-on-surface-variant)', cursor: 'pointer', fontSize: 16, padding: 2 }}
                        >×</button>
                      )}
                    </div>
                  </div>
                </div>

                <label style={{ display: 'block', fontSize: 12 }}>
                  {t("soundboard.category")}
                  <input
                    list={categoriesId}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder={t("soundboard.categoryPlaceholder")}
                    style={{ ...CHAMP, marginTop: 4 }}
                  />
                  <datalist id={categoriesId}>
                    {existingCategories.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </label>

                {editing?.ttsModel && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 10,
                    background: 'var(--color-surface-container)', fontSize: 11, color: 'var(--color-on-surface-variant)',
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: 0.4, padding: '1px 5px', borderRadius: 999,
                      background: 'var(--color-primary)', color: 'var(--color-on-primary)',
                    }}>{t("tts.badge")}</span>
                    {t("tts.generatedWith", { model: TTS_MODEL_LABELS[editing.ttsModel] || editing.ttsModel })}
                  </div>
                )}

                {file && (
                  <AudioTrimmer
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    file={file}
                    maxSec={MAX_CLIP_SEC}
                    gain={gain}
                    onChange={(start, end, buffer) => { regionRef.current = { start, end, buffer }; }}
                  />
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{t("soundboard.gain.label")}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(gain * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      className="sion-range"
                      min={SOUND_GAIN_MIN}
                      max={SOUND_GAIN_MAX}
                      step={0.05}
                      value={gain}
                      onChange={(e) => setGain(parseFloat(e.target.value))}
                      style={{ width: '100%', '--sion-range-progress': `${Math.round((gain - SOUND_GAIN_MIN) / (SOUND_GAIN_MAX - SOUND_GAIN_MIN) * 100)}%` } as React.CSSProperties}
                    />
                  </label>
                  {editing && (
                    <button
                      type="button"
                      disabled={previewBusy}
                      onClick={async () => {
                        if (previewBusy) return;
                        setPreviewBusy(true);
                        try {
                          await playSoundLocal(editing.mxcUrl, gain);
                        } catch (err) {
                          console.warn("[Sion] preview failed:", err);
                        } finally {
                          setTimeout(() => setPreviewBusy(false), 200);
                        }
                      }}
                      style={{ ...styleBouton(false, !previewBusy), alignSelf: 'flex-start' }}
                    >▶ {t("soundboard.gain.test")}</button>
                  )}
                </div>
              </>
            )}

            {error && <div role="alert" style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</div>}
          </div>
        </div>

        <div className="sion-board-import-actions" style={{ display: 'flex', flexShrink: 0, flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={styleBouton(false)}>{t("auth.cancel")}</button>
          <button type="button" onClick={handleSubmit} disabled={!peutEnvoyer} style={styleBouton(true, peutEnvoyer)}>
            {busy ? '…' : editing ? t("soundboard.editBtn") : t("soundboard.uploadBtn")}
          </button>
        </div>
      </div>

      {showEmojiPicker && pickerBox && (
        <>
          <div onClick={() => setShowEmojiPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 10001 }} />
          <div style={{
            position: 'fixed', top: pickerBox.top, left: pickerBox.left, width: pickerBox.width, height: EMOJI_PANEL_H,
            zIndex: 10002, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12,
            background: 'var(--color-surface-container-high)', border: '1px solid var(--color-outline-variant)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}>
            <EmojiGridPanel emojiSize={32} onPick={(e) => { setEmoji(e); setShowEmojiPicker(false); }} />
          </div>
        </>
      )}

      {mode === "url" && (
        <div style={{ ...FOND, zIndex: 10003 }}>
          <div role="dialog" aria-modal="true" aria-labelledby={titreLienId} style={{ ...CARTE, width: 500, maxHeight: 'calc(100dvh - 32px)', overflow: 'hidden' }}>
            <div id={titreLienId} className="sion-titre" style={{ flexShrink: 0, fontSize: 16, fontWeight: 700 }}>{t("soundboard.importLinkTitle")}</div>
            <div className="sion-board-import-corps" style={{ minHeight: 0, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
              <ExternalAudioImport onImported={(f, title) => { handleFile(f); if (title && !label) setLabel(title); setMode("file"); }} />
            </div>
            <div className="sion-board-import-actions" style={{ display: 'flex', flexShrink: 0, justifyContent: 'flex-end' }}>
              <button type="button" style={styleBouton(false)} onClick={() => setMode("file")}>{t("auth.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
