import { useTranslation } from "react-i18next";
import { Bulle } from "./Bulle";
import { SettingsIcon, ServerIcon } from "../icons";
import { UserAvatar } from "../sidebar/UserAvatar";
import { AccountPopover } from "../sidebar/AccountPopover";
import { useAppStore } from "../../stores/useAppStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useAdminStore } from "../../stores/useAdminStore";
import { usePendingUsersStore } from "../../stores/usePendingUsersStore";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { preloadHeavyScreens } from "../../services/lazyScreens";
import { useFenetreEtroite } from "../../hooks/useFenetreEtroite";

export function RailServeurs() {
  const { t } = useTranslation();
  const credentials = useAuthStore((s) => s.credentials);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const pendingCount = usePendingUsersStore((s) => s.pendingCount);
  const mode = useLayoutStore((s) => s.sidebarMode);
  const showAccount = useAppStore((s) => s.showAccountPanel);
  const showAdmin = useAppStore((s) => s.showAdmin);
  const showSettings = useAppStore((s) => s.showSettings);
  const etroite = useFenetreEtroite();
  const nom = credentials?.displayName || credentials?.userId || "Sion";
  return (
    <>
      <Bulle as="nav" className="sion-rail" aria-label={t("layout.navigation")}>
        <button className="sion-rail-bouton" aria-label={t("layout.toggleSidebar")} title={t("layout.toggleSidebar")} aria-pressed={mode === "full"}
          onClick={() => useLayoutStore.getState().toggleSidebar()}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 16h6V8h7v16h7v-8h6" />
          </svg>
        </button>
        <button className="sion-rail-bouton" data-panel-toggle aria-label={t("settings.account")} title={nom} aria-pressed={showAccount}
          onClick={() => useAppStore.getState().toggleAccountPanel()}>
          <UserAvatar name={nom} speaking={false} size="md" avatarUrl={credentials?.avatarUrl} />
        </button>
        {isAdmin === true && <button className="sion-rail-bouton" data-panel-toggle aria-label={t("admin.title")} title={t("admin.title")} aria-pressed={showAdmin}
          onClick={() => useAppStore.getState().toggleAdmin()}>
          <ServerIcon />
          {pendingCount > 0 && <span className="sion-rail-compteur">{pendingCount}</span>}
        </button>}
        <div style={{ flex: 1 }} />
        {(mode !== "full" || etroite) && <>
          <hr style={{ width: 32, border: 0, borderTop: "1px solid var(--color-border)" }} />
          <button className="sion-rail-bouton" data-panel-toggle aria-label={t("settings.title")} title={t("settings.title")} aria-pressed={showSettings}
            onPointerEnter={() => preloadHeavyScreens(0)} onClick={() => useAppStore.getState().toggleSettings()}>
            <SettingsIcon />
          </button>
        </>}
      </Bulle>
      <AccountPopover compact />
    </>
  );
}
