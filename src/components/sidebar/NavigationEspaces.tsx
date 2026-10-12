import { useEspacesStore } from "../../stores/useEspacesStore";
import { choisirEspace } from "../../hooks/useEspaces";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { DirectMessagesIcon, PlusIcon, SettingsIcon, ShareIcon } from "../icons";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { useNonLusNavigation } from "../../hooks/useNonLusNavigation";
import { salonsDansEspace } from "../../utils/espaces";
import { getMatrixClient, leaveRoom } from "../../services/matrixService";
import * as cacheRust from "../../services/cacheRust";
import { moteurRust } from "../../services/moteur";
import { partagerInvitation } from "../../services/partageInvitation";
import { gestesMenuContextuel, ouvertALInstant, STYLE_SANS_SELECTION } from "../../utils/menuContextuel";
import { MenuMessage } from "../chat/MenuMessage";
import "./NavigationEspaces.css";

/** Les mêmes espaces sur desktop (rail) et mobile (onglets). */
export function NavigationEspaces({ rail = false, horizontal = false, mobile = false }: { rail?: boolean; horizontal?: boolean; mobile?: boolean }) {
  const { t } = useTranslation();
  const channels = useMatrixStore((s) => s.channels);
  const espaceActif = useEspacesStore((s) => s.espaceActif);
  const hierarchies = useEspacesStore((s) => s.hierarchies);
  const espaces = channels.filter((c) => c.isSpace);
  const sidebarView = useSettingsStore((s) => s.sidebarView);
  const activeChannel = useAppStore((s) => s.activeChannel);
  const currentUserId = useMatrixStore((s) => s.currentUserId);
  const { unreadDMs, unreadEspaces } = useNonLusNavigation();
  const navigation = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ espace: string; x: number; y: number } | null>(null);
  const [retour, setRetour] = useState<{ texte: string; erreur?: boolean } | null>(null);
  const monte = useRef(false);
  useEffect(() => { monte.current = true; return () => { monte.current = false; }; }, []);
  useEffect(() => {
    if (!retour) return;
    const timer = window.setTimeout(() => setRetour(null), 4000);
    return () => window.clearTimeout(timer);
  }, [retour]);
  const espaceMenu = espaces.find((e) => e.id === menu?.espace);
  const fermerMenu = useCallback((restaurerFocus?: boolean) => {
    if (restaurerFocus) Array.from(navigation.current?.querySelectorAll<HTMLButtonElement>("[data-space-id]") ?? [])
      .find((b) => b.dataset.spaceId === menu?.espace)?.focus();
    setMenu(null);
  }, [menu?.espace]);

  const derniers = useRef<{ utilisateur: string | null; dm: string | null }>({
    utilisateur: currentUserId, dm: null,
  });
  useEffect(() => {
    if (derniers.current.utilisateur !== currentUserId) {
      derniers.current = { utilisateur: currentUserId, dm: null };
    }
    const salon = channels.find((c) => c.id === activeChannel);
    if (salon?.isDM && !salon.isSoundboard && !salon.isSpace) derniers.current.dm = salon.id;
  }, [activeChannel, channels, currentUserId]);

  const choisirMp = () => {
    if (activeChannel && salonsDansEspace(channels, espaceActif, hierarchies).some((c) => c.id === activeChannel)) {
      useEspacesStore.getState().memoriserSalon(espaceActif, activeChannel);
    }
    useSettingsStore.getState().setSidebarView("dm");
    const layout = useLayoutStore.getState();
    if (rail && !mobile && layout.sidebarMode === "hidden") layout.setSidebarMode("rail");
    // Revenir à la dernière conversation de cet espace n'agit pas sur le vocal.
    if (rail && !mobile) {
      const dernier = channels.find((c) => c.id === derniers.current.dm && !c.isSoundboard && c.isDM);
      if (dernier && dernier.id !== activeChannel) {
        useAppStore.getState().setActiveChannel(dernier.id, dernier.hasVoice);
      }
    }
    if (mobile) useAppStore.getState().setMobileView("sidebar");
  };
  const classe = rail ? "sion-rail-bouton" : "sion-espace-onglet";
  const compteur = (nombre: number) => nombre > 0 && <span className="sion-rail-compteur" aria-hidden="true">{nombre > 99 ? "99+" : nombre}</span>;
  const nonLus = (nombre: number) => nombre > 0 ? ` — ${t("chat.unreadCount", { count: nombre })}` : "";
  const boutonMp = (
    <button type="button" className={classe} data-espace="dm"
      aria-label={t("channels.tabDM") + nonLus(unreadDMs)} title={t("channels.tabDM")}
      aria-pressed={sidebarView === "dm"} onClick={choisirMp}
      onContextMenu={async (e) => {
        e.preventDefault();
        const myUserId = useMatrixStore.getState().currentUserId;
        const empties = channels.filter((ch) =>
          ch.isDM
          && (ch.voiceUsers?.length ?? 0) === 0
          && !!myUserId
          // Only "empty" DMs: ours is the sole surviving member
          && (() => {
            if (moteurRust()) {
              const membres = cacheRust.detailsSalon(ch.id)?.membres ?? [];
              return membres.length === 1 && membres[0].userId === myUserId;
            }
            try {
              const cli = getMatrixClient();
              const room = cli?.getRoom(ch.id);
              if (!room) return false;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const live = (room.getMembers?.() || []).filter((m: any) =>
                m.membership === "join" || m.membership === "invite",
              );
              return live.length === 1 && live[0].userId === myUserId;
            } catch { return false; }
          })()
        );
        if (empties.length === 0) {
          window.alert("Aucune conversation vide à nettoyer.");
          return;
        }
        if (!window.confirm(`Quitter ${empties.length} conversation(s) vide(s) ?`)) return;
        const cli = getMatrixClient();
        for (const ch of empties) {
          try {
            if (moteurRust()) await leaveRoom(ch.id);
            else await cli?.leave(ch.id);
          } catch (err) {
            console.warn("[Sion][DM] bulk leave failed for", ch.id, err);
          }
        }
        window.alert(`${empties.length} conversation(s) vide(s) quittée(s).`);
      }}>
      <DirectMessagesIcon />{!rail && t("channels.tabDM")}
      {compteur(unreadDMs)}
    </button>
  );
  const boutonsEspaces = espaces.map((espace) => <button type="button" key={espace.id} data-space-id={espace.id} className={classe}
    title={espace.name} aria-label={`${espace.name}${nonLus(unreadEspaces[espace.id] ?? 0)}${espace.membership === "invite" ? ` — ${t("spaces.invitation")}` : ""}`}
    aria-pressed={sidebarView === "channels" && espaceActif === espace.id}
    aria-haspopup="menu" aria-expanded={menu?.espace === espace.id} style={STYLE_SANS_SELECTION}
    onClick={() => { if (ouvertALInstant()) return; fermerMenu(); choisirEspace(espace.id); if (mobile) useAppStore.getState().setMobileView("sidebar"); if (espace.membership === "invite") useEspacesStore.getState().ouvrir("gerer"); }}
    {...gestesMenuContextuel((x, y) => setMenu({ espace: espace.id, x, y }))}
    onKeyDown={(e) => {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      e.preventDefault(); e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ espace: espace.id, x: r.right, y: r.top });
    }}>
    {espace.icon ? <span className="sion-espace-logo"><img src={espace.icon} alt="" draggable={false} /></span> : <span aria-hidden="true">{espace.name.slice(0, 2).toUpperCase()}</span>}
    {espace.membership === "invite" ? <span className="sion-rail-compteur">!</span> : compteur(unreadEspaces[espace.id] ?? 0)}
  </button>);
  const ajouter = <button className={`${classe} sion-espace-ajouter`} type="button" aria-label={t("spaces.add")} title={t("spaces.add")}
    onClick={() => useEspacesStore.getState().ouvrir("ajouter")}><PlusIcon /></button>;
  return <><div ref={navigation} className={`sion-navigation-espaces sion-navigation-espaces--${rail ? "rail" : "onglets"}${rail && horizontal ? " sion-navigation-espaces--horizontal" : ""}`}>
    {rail ? <>{boutonMp}{!horizontal && <hr className="sion-rail-separation" />}<div className="sion-espaces-rail-liste">{boutonsEspaces}{ajouter}</div></> : <>{boutonMp}{boutonsEspaces}{ajouter}</>}
  </div>
    {menu && espaceMenu && <MenuMessage x={menu.x} y={menu.y} onClose={fermerMenu} actions={[
      { label: t("spaces.shareInvitation"), icon: <ShareIcon />, action: () => {
        void partagerInvitation(espaceMenu.id, t("spaces.shareInvitationTitle", { name: espaceMenu.name }), mobile)
          .then((resultat) => { if (monte.current && resultat === "copie") setRetour({ texte: t("spaces.copied") }); })
          .catch(() => { if (monte.current) setRetour({ texte: t("spaces.shareFailed"), erreur: true }); });
      } },
      { label: t("spaces.manageSpace"), icon: <SettingsIcon />, action: () => {
        choisirEspace(espaceMenu.id);
        if (mobile) useAppStore.getState().setMobileView("sidebar");
        useEspacesStore.getState().ouvrir("gerer");
      } },
    ]} />}
    {retour && createPortal(<div className={`sion-espace-retour${retour.erreur ? " sion-espace-retour--erreur" : ""}`}
      role={retour.erreur ? "alert" : "status"}>{retour.texte}</div>, document.body)}
  </>;
}
