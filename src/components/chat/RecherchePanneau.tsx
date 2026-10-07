/** Recherche des sons et memes, avec l'ajout intégré au même champ. */
export function RecherchePanneau({ valeur, onChange, libelle, ajout }: {
  valeur: string;
  onChange: (valeur: string) => void;
  libelle: string;
  ajout?: { libelle: string; onClick: () => void };
}) {
  return <div className="sion-recherche-panneau">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" />
    </svg>
    <input type="search" aria-label={libelle} placeholder={libelle} value={valeur} onChange={(e) => onChange(e.target.value)} />
    {ajout && <button type="button" aria-label={ajout.libelle} title={ajout.libelle} onClick={ajout.onClick}>+</button>}
  </div>;
}
