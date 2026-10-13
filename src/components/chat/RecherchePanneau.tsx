import { useRef } from "react";
import { CloseIcon } from "../icons";

/** Recherche dans un panneau, avec ses actions intégrées au champ. */
export function RecherchePanneau({ valeur, onChange, libelle, ajout, effacer }: {
  valeur: string;
  onChange: (valeur: string) => void;
  libelle: string;
  ajout?: { libelle: string; onClick: () => void };
  effacer?: string;
}) {
  const champ = useRef<HTMLInputElement>(null);
  return <div className="sion-recherche-panneau">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" />
    </svg>
    <input ref={champ} type="search" aria-label={libelle} placeholder={libelle} value={valeur} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (effacer && valeur && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onChange("");
        }
      }} />
    {effacer && valeur && <button type="button" className="sion-recherche-effacer" aria-label={effacer} title={effacer}
      onClick={() => { onChange(""); champ.current?.focus(); }}><CloseIcon /></button>}
    {ajout && <button type="button" aria-label={ajout.libelle} title={ajout.libelle} onClick={ajout.onClick}>+</button>}
  </div>;
}
