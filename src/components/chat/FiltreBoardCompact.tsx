import { useTranslation } from "react-i18next";
import { sortedChildren, type TreeNode } from "../../utils/categories";

function chemins(noeud: TreeNode): TreeNode[] {
  return sortedChildren(noeud).flatMap((enfant) => [enfant, ...chemins(enfant)]);
}

/** Le même filtre et le même arbre que les pilules, dans une bande horizontale. */
export function FiltreBoardCompact({ arbre, mode, categorie, toutes, libelle, onChange, onMasquer }: {
  arbre: TreeNode;
  mode: "all" | "top";
  categorie: string | null;
  toutes: string;
  libelle: string;
  onChange: (mode: "all" | "top", categorie: string | null) => void;
  onMasquer?: (categorie: string) => void;
}) {
  const { t } = useTranslation();
  return <select className="sion-board-filtre-compact" aria-label={libelle}
    value={mode === "top" ? "top" : categorie ? `category:${categorie}` : "all"}
    onChange={(e) => {
      const valeur = e.currentTarget.value;
      onChange(valeur === "top" ? "top" : "all", valeur.startsWith("category:") ? valeur.slice(9) : null);
    }}
    onContextMenu={onMasquer && categorie ? (e) => { e.preventDefault(); onMasquer(categorie); } : undefined}>
    <option value="top">🔥 {t("soundboard.top")}</option>
    <option value="all">{toutes}</option>
    {chemins(arbre).map((noeud) => <option key={noeud.fullPath} value={`category:${noeud.fullPath}`}>
      {noeud.fullPath.replace(/\//g, " · ")}
    </option>)}
  </select>;
}
