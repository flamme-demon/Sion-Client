import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Channel } from "../../types/matrix";
import { useAppStore } from "../../stores/useAppStore";
import { LogoutIcon } from "../icons";
import "./GestionEspaces.css";

export function ConfirmationDepartSalon({ salon, onConfirmer, onFermer }: {
  salon: Channel;
  onConfirmer: () => Promise<void>;
  onFermer: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialogue = useRef<HTMLDivElement>(null);
  const annuler = useRef<HTMLButtonElement>(null);
  const enCours = useRef(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(false);
  const vocal = useAppStore((s) => s.connectedVoiceChannel === salon.id);

  useEffect(() => { annuler.current?.focus(); }, []);
  const fermer = () => { if (!enCours.current) onFermer(); };
  const confirmer = async () => {
    if (enCours.current) return;
    enCours.current = true;
    setOccupe(true); setErreur(false);
    dialogue.current?.focus();
    try { await onConfirmer(); onFermer(); }
    catch (e) { console.warn("[Sion] Départ du salon impossible", e); setErreur(true); }
    finally { enCours.current = false; setOccupe(false); }
  };
  return createPortal(<div className="sion-espaces-fond"
    onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) fermer(); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); fermer(); }
      if (e.key !== "Tab") return;
      const boutons = Array.from(dialogue.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const premier = boutons[0], dernier = boutons.at(-1);
      if (!premier) { e.preventDefault(); return; }
      if (document.activeElement === dialogue.current) { e.preventDefault(); (e.shiftKey ? dernier : premier)?.focus(); }
      else if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier?.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    }}>
    <div className="sion-espaces-dialogue sion-depart-salon" ref={dialogue} tabIndex={-1}
      role="alertdialog" aria-modal="true" aria-busy={occupe} aria-labelledby={`${id}-titre`} aria-describedby={`${id}-description`}>
      <header><span className="sion-espaces-entete-icone" aria-hidden="true"><LogoutIcon /></span>
        <h2 id={`${id}-titre`}>{salon.isDM ? t("channels.leaveConversation", { defaultValue: "Quitter cette conversation" })
          : t("channels.leave", { defaultValue: "Quitter le salon" })}</h2></header>
      <p id={`${id}-description`}>{salon.isDM
        ? t("channels.leaveConversationConfirm", { name: salon.name, defaultValue: "Quitter la conversation avec {{name}} ?" })
        : t("channels.leaveConfirm", { name: salon.name, defaultValue: "Quitter le salon « {{name}} » ?" })}</p>
      {vocal && <p>{t("channels.leaveVoiceHelp", { defaultValue: "Tu seras aussi déconnecté de son appel vocal." })}</p>}
      {erreur && <p role="alert" className="sion-espaces-erreur">{t("channels.leaveError", { defaultValue: "Impossible de quitter le salon. Réessaie." })}</p>}
      <div className="sion-espaces-actions">
        <button ref={annuler} type="button" className="sion-espaces-annuler" data-action="annuler-depart" disabled={occupe} onClick={fermer}>{t("auth.cancel")}</button>
        <button type="button" className="sion-depart-confirmer" data-action="confirmer-depart" disabled={occupe} onClick={() => void confirmer()}>
          {occupe ? t("channels.leaving", { defaultValue: "Départ…" }) : t("channels.leaveAction", { defaultValue: "Quitter" })}
        </button>
      </div>
    </div>
  </div>, document.body);
}
