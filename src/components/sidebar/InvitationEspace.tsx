import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { rechercherUtilisateurs } from "../../services/matrixService";
import type { ResultatAnnuaire, UtilisateurAnnuaire } from "../../services/matrixCore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { CloseIcon, UserAddIcon } from "../icons";
import { UserAvatar } from "./UserAvatar";

export function InvitationEspace({ membres, visible, disabled, onInvite, onInvited }: {
  membres: { userId: string }[];
  visible: boolean;
  disabled: boolean;
  onInvite: (utilisateur: string) => Promise<boolean>;
  onInvited?: (profil: UtilisateurAnnuaire) => void;
}) {
  const { t } = useTranslation();
  const moi = useMatrixStore((s) => s.currentUserId);
  const [texte, setTexte] = useState("");
  const [choisi, setChoisi] = useState<UtilisateurAnnuaire | null>(null);
  const [annuaire, setAnnuaire] = useState<{ terme: string; resultat?: ResultatAnnuaire; erreur?: boolean }>();
  const [invites, setInvites] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [essai, setEssai] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listeId = useId();
  const terme = texte.trim();
  useEffect(() => {
    if (!visible || choisi || terme.length < 2) return;
    let actif = true;
    const attente = window.setTimeout(() => {
      void rechercherUtilisateurs(terme).then((resultat) => {
        if (actif) setAnnuaire({ terme, resultat });
      }).catch(() => { if (actif) setAnnuaire({ terme, erreur: true }); });
    }, 200);
    return () => { actif = false; window.clearTimeout(attente); };
  }, [terme, choisi, visible, essai]);
  const exclu = (id: string) => id === moi || membres.some((m) => m.userId === id) || invites.includes(id);
  const reponse = annuaire?.terme === terme ? annuaire : undefined;
  const utilisateurs = reponse?.resultat?.utilisateurs.filter((u) => !exclu(u.userId)) ?? [];
  // Un identifiant complet reste utilisable pour inviter une autre équipe,
  // même si son profil n'est pas encore connu de l'annuaire local.
  if (/^@[^\s:]+:[^\s]+$/.test(terme) && !exclu(terme) && !utilisateurs.some((u) => u.userId === terme)) {
    utilisateurs.push({ userId: terme, displayName: terme.slice(1).split(":")[0], avatarUrl: null });
  }
  const resultats = choisi ? [] : utilisateurs.slice(0, 10);
  const selectionner = (utilisateur: UtilisateurAnnuaire) => {
    setChoisi(utilisateur); setTexte(utilisateur.displayName); setIndex(-1);
  };
  const rechercher = () => { setChoisi(null); setTexte(""); setIndex(-1); input.current?.focus(); };
  const rechercheEnCours = !choisi && terme.length >= 2 && !reponse;
  const actif = index >= 0 && index < resultats.length ? index : -1;
  return <form onSubmit={(e) => {
    e.preventDefault();
    if (!choisi || disabled) return;
    const profil = choisi;
    const utilisateur = profil.userId;
    void onInvite(utilisateur).then((envoyee) => {
      if (envoyee) {
        if (onInvited) onInvited(profil);
        else setInvites((a) => [...a, utilisateur]);
        rechercher();
      }
    });
  }}>
    <label>{t("spaces.searchMember")}<input ref={input} value={texte} disabled={disabled} maxLength={255}
      placeholder={t("spaces.searchMemberPlaceholder")} autoComplete="off" role="combobox"
      aria-expanded={resultats.length > 0} aria-controls={resultats.length ? listeId : undefined}
      aria-autocomplete="list" aria-activedescendant={actif >= 0 ? `${listeId}-${actif}` : undefined}
      onChange={(e) => { setTexte(e.target.value); setChoisi(null); setIndex(-1); }}
      onKeyDown={(e) => {
        if (["ArrowDown", "ArrowUp"].includes(e.key) && resultats.length) {
          e.preventDefault();
          const prochain = e.key === "ArrowDown" ? (actif + 1) % resultats.length : (actif <= 0 ? resultats.length : actif) - 1;
          setIndex(prochain);
          document.getElementById(`${listeId}-${prochain}`)?.scrollIntoView?.({ block: "nearest" });
        }
        if (e.key === "Enter" && !choisi) { e.preventDefault(); if (actif >= 0) selectionner(resultats[actif]); }
        if (e.key === "Escape" && (choisi || terme)) { e.preventDefault(); e.stopPropagation(); rechercher(); }
      }} /></label>
    {!choisi && <p>{t("spaces.searchMemberHelp")}</p>}
    {choisi ? <div className="sion-espaces-invite-selection">
      <UserAvatar name={choisi.displayName} avatarUrl={choisi.avatarUrl ?? undefined} speaking={false} size="md" />
      <span><strong>{choisi.displayName}</strong><small>{choisi.userId}</small></span>
      <button type="button" aria-label={t("spaces.changeMember")} onClick={rechercher}><CloseIcon /></button>
    </div> : <>
      {resultats.length > 0 && <div className="sion-espaces-invite-resultats" role="listbox" id={listeId} aria-label={t("spaces.searchMember")}>
        {resultats.map((u, i) => <button key={u.userId} id={`${listeId}-${i}`} type="button" role="option" aria-selected={actif === i}
          tabIndex={-1} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => selectionner(u)}>
          <UserAvatar name={u.displayName} avatarUrl={u.avatarUrl ?? undefined} speaking={false} size="md" />
          <span><strong>{u.displayName}</strong><small>{u.userId}</small></span>
        </button>)}
      </div>}
      {rechercheEnCours && <p role="status">{t("spaces.searchingMembers")}</p>}
      {reponse?.erreur && <div><p role="alert">{t("spaces.memberSearchUnavailable")}</p><button type="button" onClick={() => { setAnnuaire(undefined); setEssai((n) => n + 1); }}>{t("spaces.retrySearch")}</button></div>}
      {reponse?.resultat && resultats.length === 0 && <p role="status">{t("spaces.noMemberResults")}</p>}
      {(reponse?.resultat?.limite || utilisateurs.length > 10) && <p>{t("spaces.refineMemberSearch")}</p>}
    </>}
    <div className="sion-espaces-actions"><button type="submit" className="sion-espaces-primaire" disabled={disabled || !choisi}>
      <UserAddIcon />{t("spaces.invite")}
    </button></div>
  </form>;
}
