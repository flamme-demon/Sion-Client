import { useTranslation } from "react-i18next";
import { choisirEspace } from "../../hooks/useEspaces";
import { useNonLusNavigation } from "../../hooks/useNonLusNavigation";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppStore } from "../../stores/useAppStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import { HashIcon } from "../icons";
import "./SalonsHorsEspace.css";

export function SalonsHorsEspace({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const espaceActif = useEspacesStore((s) => s.espaceActif);
  const sidebarView = useSettingsStore((s) => s.sidebarView);
  const { unreadChannels } = useNonLusNavigation();
  const libelle = t("channels.outsideSpaces", { defaultValue: "Salons hors espace" });
  return <button type="button" data-salons-hors-espace
    className={`sion-salons-hors-espace${compact ? " sion-salons-hors-espace--compact" : ""}`}
    aria-label={libelle + (unreadChannels ? ` — ${t("chat.unreadCount", { count: unreadChannels })}` : "")}
    title={libelle} aria-pressed={sidebarView === "channels" && !espaceActif}
    onClick={() => {
      const vue = useAppStore.getState().mobileView;
      choisirEspace(null);
      if (mobile) useAppStore.getState().setMobileView(vue === "chat" ? "channels" : vue);
    }}>
    <HashIcon />
    {!compact && <span>{libelle}</span>}
    {unreadChannels > 0 && <span className="sion-salons-hors-espace-compteur" aria-hidden="true">{unreadChannels > 99 ? "99+" : unreadChannels}</span>}
  </button>;
}
