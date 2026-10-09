import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { TrashIcon } from "../icons";

interface Props {
  titre: string;
  description: string;
  messageErreur: string;
  onConfirmer: () => Promise<void>;
  onFermer: () => void;
}

/** Confirmation commune aux boards, rendue au-dessus de toutes les bulles. */
export function ConfirmationSuppressionBoard({ titre, description, messageErreur, onConfirmer, onFermer }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const carte = useRef<HTMLDivElement>(null);
  const annuler = useRef<HTMLButtonElement>(null);
  const enCours = useRef(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null;
    annuler.current?.focus();
    return () => { if (origine?.isConnected) origine.focus(); };
  }, []);

  const confirmer = async () => {
    if (enCours.current) return;
    enCours.current = true;
    setOccupe(true);
    setErreur(false);
    carte.current?.focus();
    try {
      await onConfirmer();
      onFermer();
    } catch (err) {
      console.warn("[Sion][boards] suppression impossible", err);
      setErreur(true);
    } finally {
      enCours.current = false;
      setOccupe(false);
    }
  };

  return createPortal(
    <div className="sion-confirmation-suppression-fond"
      onClick={(e) => { e.stopPropagation(); if (!enCours.current) onFermer(); }}
      onKeyDown={(e) => {
        // Les événements d'un portail remontent aussi au panneau React :
        // Échap doit fermer la confirmation seule, et jamais la board.
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); if (!enCours.current) onFermer(); }
        if (e.key !== "Tab") return;
        const boutons = carte.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!boutons?.length) { e.preventDefault(); return; }
        const premier = boutons[0], dernier = boutons[boutons.length - 1];
        if (document.activeElement === carte.current) { e.preventDefault(); (e.shiftKey ? dernier : premier).focus(); }
        else if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
      }}>
      <div ref={carte} className="sion-confirmation-suppression" tabIndex={-1} role="alertdialog" aria-modal="true"
        aria-labelledby={`${id}-titre`} aria-describedby={`${id}-description`} aria-busy={occupe}
        onClick={(e) => e.stopPropagation()}>
        <div className="sion-confirmation-suppression-entete">
          <span className="sion-confirmation-suppression-icone" aria-hidden="true"><TrashIcon className="size-5 fill-current" /></span>
          <h2 id={`${id}-titre`}>{titre}</h2>
        </div>
        <p id={`${id}-description`}>{description}</p>
        {erreur && <p className="sion-confirmation-suppression-erreur" role="alert">{messageErreur}</p>}
        <div className="sion-confirmation-suppression-actions">
          <button ref={annuler} type="button" data-action="annuler-suppression" disabled={occupe} onClick={onFermer}>
            {t("auth.cancel", { defaultValue: "Annuler" })}
          </button>
          <button type="button" data-action="confirmer-suppression" disabled={occupe} onClick={() => void confirmer()}>
            {occupe ? t("boardDelete.pending", { defaultValue: "Suppression…" }) : t("boardDelete.confirm", { defaultValue: "Supprimer" })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
