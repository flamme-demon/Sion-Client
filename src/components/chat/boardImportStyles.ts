import type { CSSProperties } from "react";

/** Présentation commune aux fenêtres d'ajout et d'édition des deux boards. */
export const FOND_IMPORT_BOARD: CSSProperties = {
  position: 'fixed', inset: 0, background: 'var(--color-scrim, rgba(0,0,0,0.5))',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

export const CARTE_IMPORT_BOARD: CSSProperties = {
  boxSizing: 'border-box',
  maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 12, padding: 20, borderRadius: 16,
  background: 'var(--color-surface-container-high)', color: 'var(--color-on-surface)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
};

export const CHAMP_IMPORT_BOARD: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10,
  border: '1px solid var(--color-outline-variant)', background: 'var(--color-surface-container)',
  color: 'var(--color-on-surface)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
};

export const styleBoutonImportBoard = (principal: boolean, actif = true): CSSProperties => ({
  padding: '8px 14px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600,
  fontFamily: 'inherit', cursor: actif ? 'pointer' : 'not-allowed', opacity: actif ? 1 : 0.5,
  background: principal ? 'var(--color-primary)' : 'var(--color-surface-container-highest)',
  color: principal ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
});
