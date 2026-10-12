import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { peutSupprimerMessage, supprimerMessages } from "../../services/supprimerMessages";
import { CloseIcon, TrashIcon } from "../icons";

export function BarreSelectionMessages({ salon, ids, onAnnuler, onRetirer }: {
  salon: string; ids: ReadonlySet<string>; onAnnuler: () => void; onRetirer: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const utilisateur = useMatrixStore((s) => s.currentUserId);
  const messages = useMatrixStore((s) => s.messages[salon]);
  const droits = useMatrixStore((s) => s.pinnedVersion); void droits;
  const [confirmation, setConfirmation] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const verrou = useRef(false);
  const [erreur, setErreur] = useState(0);
  const autorise = [...ids].every((id) => {
    const message = messages?.find((m) => (m.eventId || String(m.id)) === id);
    return !message || peutSupprimerMessage(salon, message, utilisateur);
  });
  useEffect(() => {
    const echap = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || verrou.current) return;
      if (confirmation) setConfirmation(false); else onAnnuler();
    };
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [confirmation, onAnnuler]);
  const supprimer = async () => {
    if (verrou.current || !autorise) return;
    verrou.current = true; setOccupe(true); setErreur(0);
    try {
      const resultat = await supprimerMessages(salon, [...ids]);
      onRetirer(resultat.supprimes);
      setErreur(resultat.echecs.length); setConfirmation(false);
    } finally { verrou.current = false; setOccupe(false); }
  };
  return <div className="sion-barre-selection" aria-live="polite" data-selection-messages>
    {confirmation ? <div className="sion-selection-confirmation" role="alertdialog" aria-label={t("chat.deleteSelectedConfirm", { count: ids.size })}>
      <strong>{t("chat.deleteSelectedConfirm", { count: ids.size })}</strong>
      <div><button disabled={occupe} onClick={() => setConfirmation(false)}>{t("auth.cancel")}</button>
        <button className="sion-selection-supprimer" disabled={occupe || !autorise} onClick={() => void supprimer()} data-confirmer-suppression>
          <TrashIcon />{t(occupe ? "chat.deletingSelected" : "chat.deleteSelected", { count: ids.size })}</button></div>
    </div> : <>
      <div style={{ flex: 1 }}><strong>{t("chat.selectedMessages", { count: ids.size })}</strong>
        {!autorise && <p style={{ fontSize: 11 }}>{t("chat.selectionNotAllowed")}</p>}
        {erreur > 0 && <p role="alert" style={{ fontSize: 11, color: "var(--color-error)" }}>{t("chat.deleteSelectedFailed", { count: erreur })}</p>}</div>
      <button className="sion-selection-supprimer" disabled={!autorise || occupe} onClick={() => setConfirmation(true)} aria-label={t("chat.deleteSelected", { count: ids.size })}><TrashIcon /></button>
      <button disabled={occupe} onClick={onAnnuler} aria-label={t("auth.cancel")}><CloseIcon /></button>
    </>}
  </div>;
}
