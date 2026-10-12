import { useTranslation } from "react-i18next";
import { useBibliothequeActive } from "../../hooks/useBibliothequeActive";

/** Une indication discrète de l'équipe dont on utilise les sons et memes. */
export function ContexteBoard() {
  const { t } = useTranslation();
  const contexte = useBibliothequeActive();
  if (!contexte.vocalId && !contexte.espaceId) return null;
  const space = contexte.espaceNom ?? contexte.vocalNom ?? t("boards.server", { defaultValue: "Serveur" });
  const texte = contexte.vocalId
    ? t("boards.voiceContext", { space, defaultValue: "Vocal · {{space}}" }) : space;
  const title = contexte.vocalId
    ? t("boards.voiceContextHint", { space, room: contexte.vocalNom ?? space,
      defaultValue: "Bibliothèque de {{space}} pour le vocal {{room}}." }) : space;
  return <span className="sion-contexte-board" data-contexte-board={contexte.vocalId ? "vocal" : "espace"} title={title}>{texte}</span>;
}
