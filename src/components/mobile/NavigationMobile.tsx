import { useTranslation } from "react-i18next";
import { memo } from "react";
import { useGlissementMobile } from "../../hooks/useGlissementMobile";
import { useAppStore } from "../../stores/useAppStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useAdminStore } from "../../stores/useAdminStore";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { MainArea } from "../layout/MainArea";
import { NavigationEspaces } from "../sidebar/NavigationEspaces";
import { ChannelList } from "../sidebar/ChannelList";
import { AccountPopover } from "../sidebar/AccountPopover";
import { UserAvatar } from "../sidebar/UserAvatar";
import { VerificationBanner } from "../sidebar/VerificationBanner";
import { DirectMessagesIcon, HashIcon, ServerIcon, SettingsIcon } from "../icons";
import { MOBILE_VOICE_BAR_HEIGHT } from "./MobileVoiceBar";
import { MobilePanelSheet } from "./MobilePanelSheet";
import "./NavigationMobile.css";

const ConversationMobile = memo(MainArea);
const ListeSalonsMobile = memo(ChannelList);

function EnteteSalonsMobile() {
  const { t } = useTranslation();
  const espaceId = useEspacesStore((s) => s.espaceActif);
  const espace = useMatrixStore((s) => s.channels.find((c) => c.id === espaceId && c.isSpace));
  const prive = useSettingsStore((s) => s.sidebarView === "dm");
  const compte = useAuthStore((s) => s.credentials);
  const titre = prive ? t("channels.directMessages") : espace?.name ?? t("channels.outsideSpaces", { defaultValue: "Salons hors espace" });
  return <header className="sion-mobile-canaux-entete">
    <button type="button" className="sion-mobile-ouvrir-espaces" aria-label={t("spaces.title")}
      title={t("spaces.title")} onClick={() => useAppStore.getState().setMobileView("sidebar")}>
      {prive ? <DirectMessagesIcon /> : espace?.icon ? <img src={espace.icon} alt="" /> : <HashIcon />}
    </button>
    <button type="button" className="sion-mobile-nom-espace sion-titre" title={titre}
      onClick={() => { if (espace && !prive) useEspacesStore.getState().ouvrir("gerer"); }}>
      {titre}
    </button>
    <button type="button" className="sion-mobile-compte" data-panel-toggle aria-label={t("settings.account")}
      onClick={() => useAppStore.getState().toggleAccountPanel()}>
      <UserAvatar name={compte?.displayName || compte?.userId || "Sion"} avatarUrl={compte?.avatarUrl} speaking={false} size="sm" />
    </button>
  </header>;
}

/** Un chat monté en permanence, derrière une navigation à deux paliers. */
export function NavigationMobile() {
  const { t } = useTranslation();
  const vue = useAppStore((s) => s.mobileView);
  const vocal = useAppStore((s) => s.connectedVoiceChannel);
  const admin = useAdminStore((s) => s.isAdmin === true);
  const { ref, refMenu, refChat, refRetourChat, enGeste, gestes } = useGlissementMobile();
  return <>
    <div ref={ref} className="sion-mobile-navigation" data-mobile-view={vue} {...gestes}>
      <nav ref={refMenu} className="sion-mobile-menu" aria-label={t("layout.navigation")}
        aria-hidden={vue === "chat" && !enGeste} inert={vue === "chat" && !enGeste}
        style={vocal ? { paddingBottom: MOBILE_VOICE_BAR_HEIGHT } : undefined}>
        <div className="sion-mobile-espaces" aria-hidden={vue === "channels" && !enGeste} inert={vue === "channels" && !enGeste}>
          <NavigationEspaces rail mobile />
          <div className="sion-mobile-espaces-outils">
            {admin && <button type="button" className="sion-rail-bouton" data-panel-toggle aria-label={t("admin.title")}
              onClick={() => useAppStore.getState().toggleAdmin()}><ServerIcon /></button>}
            <button type="button" className="sion-rail-bouton" data-panel-toggle aria-label={t("settings.title")}
              onClick={() => useAppStore.getState().toggleSettings()}><SettingsIcon /></button>
          </div>
        </div>
        <div className="sion-mobile-canaux">
          <EnteteSalonsMobile />
          <VerificationBanner />
          <ListeSalonsMobile navigationEspaces={false} />
        </div>
      </nav>
      <div ref={refChat} className="sion-mobile-chat" aria-hidden={vue === "sidebar" && !enGeste} inert={vue !== "chat"}>
        <ConversationMobile />
      </div>
      {vue === "channels" && !enGeste && <button ref={refRetourChat} type="button" className="sion-mobile-retour-chat"
        aria-label={t("app.returnToChat", { defaultValue: "Revenir au chat" })}
        onClick={() => useAppStore.getState().setMobileView("chat")} />}
    </div>
    <AccountPopover />
    <MobilePanelSheet />
  </>;
}
