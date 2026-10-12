import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CloseIcon, HistoryIcon } from "../icons";
import { ConservationPanel } from "./ConservationPanel";
import "./GestionEspaces.css";

export function ConservationSalon({ salonId, onFermer }: { salonId: string; onFermer: () => void }) {
  const { t } = useTranslation();
  const titre = useId();
  const dialogue = useRef<HTMLDivElement>(null);
  const fermeture = useRef<HTMLButtonElement>(null);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null;
    fermeture.current?.focus();
    return () => { if (origine?.isConnected) origine.focus(); };
  }, []);
  return createPortal(<div className="sion-espaces-fond" onMouseDown={(e) => { if (e.target === e.currentTarget && !occupe) onFermer(); }}>
    <div className="sion-espaces-dialogue" role="dialog" aria-modal="true" aria-labelledby={titre} ref={dialogue}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); if (!occupe) onFermer(); }
        if (e.key !== "Tab") return;
        const elements = Array.from(dialogue.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []);
        const premier = elements[0], dernier = elements.at(-1);
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier?.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier?.focus(); }
      }}>
      <header><span className="sion-espaces-entete-icone"><HistoryIcon /></span><h2 id={titre}>{t("conservation.title")}</h2>
        <button type="button" className="sion-espaces-fermer" ref={fermeture} disabled={occupe} onClick={onFermer} aria-label={t("chat.close")}><CloseIcon /></button>
      </header><section><ConservationPanel scopeId={salonId} onBusyChange={setOccupe} /></section>
    </div>
  </div>, document.body);
}
