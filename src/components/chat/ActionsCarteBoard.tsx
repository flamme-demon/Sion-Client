import { PencilIcon, TrashIcon } from "../icons";

interface ActionCarte {
  libelle: string;
  onClick: () => void;
}

/** Les deux boards partagent la même disposition ; les droits restent décidés
 * par chaque panneau. Les actions ne déclenchent pas la lecture de la carte. */
export function ActionsCarteBoard({ modifier, supprimer }: {
  modifier?: ActionCarte;
  supprimer?: ActionCarte;
}) {
  if (!modifier && !supprimer) return null;
  return (
    <div className="sion-actions-carte-board">
      {modifier && (
        <button type="button" data-action="modifier" className="sion-action-carte-modifier"
          aria-label={modifier.libelle} title={modifier.libelle}
          onClick={(e) => { e.stopPropagation(); modifier.onClick(); }}>
          <PencilIcon className="size-3.5 fill-current" />
        </button>
      )}
      {supprimer && (
        <button type="button" data-action="supprimer" className="sion-action-carte-supprimer"
          aria-label={supprimer.libelle} title={supprimer.libelle}
          onClick={(e) => { e.stopPropagation(); supprimer.onClick(); }}>
          <TrashIcon className="size-3.5 fill-current" />
        </button>
      )}
    </div>
  );
}
