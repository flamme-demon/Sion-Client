import { useTranslation } from "react-i18next";
import { useCallback, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
import { Bulle } from "./Bulle";
import { SettingsIcon, ServerIcon } from "../icons";
import { NavigationEspaces } from "../sidebar/NavigationEspaces";
import { UserAvatar } from "../sidebar/UserAvatar";
import { AccountPopover } from "../sidebar/AccountPopover";
import { useAppStore } from "../../stores/useAppStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useAdminStore } from "../../stores/useAdminStore";
import { usePendingUsersStore } from "../../stores/usePendingUsersStore";
import { useLayoutStore, type ZonePanneau } from "../../stores/useLayoutStore";
import { useDeplacementModule } from "./useDeplacementModule";
import { preloadHeavyScreens } from "../../services/lazyScreens";
import "./BarreEspaces.css";

export function RailServeurs({ zone = "bottom" }: { zone?: ZonePanneau }) {
  const { t } = useTranslation();
  const credentials = useAuthStore((s) => s.credentials);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const pendingCount = usePendingUsersStore((s) => s.pendingCount);
  const mode = useLayoutStore((s) => s.sidebarMode);
  const showAdmin = useAppStore((s) => s.showAdmin);
  const showSettings = useAppStore((s) => s.showSettings);
  const deplacement = useDeplacementModule("espaces");
  const horizontal = zone === "top" || zone === "bottom";
  const [cadre, setCadre] = useState<HTMLElement | null>(null);
  const ancrer = useCallback((element: HTMLSpanElement | null) => {
    setCadre(element?.closest<HTMLElement>(".app-root--desktop") ?? null);
  }, []);
  const libelleDeplacement = t("layout.moveSpaces");
  const nom = credentials?.displayName || credentials?.userId || "Sion";
  const nombreOutils = 1 + (isAdmin === true ? 1 : 0) + (mode === "hidden" ? 2 : 0);
  const styleNavigation = { "--sion-largeur-outils": `${Math.max(70, nombreOutils * 52 + 1)}px` } as CSSProperties;
  const navigation = (
    <div className={`sion-barre-espaces sion-barre-espaces--${zone}`} data-panneau="espaces" data-zone-espaces={zone}>
      <Bulle as="nav" className="sion-rail" aria-label={t("layout.navigation")} style={styleNavigation}>
        <div className="sion-barre-espaces-poignee" role="button" tabIndex={0} aria-label={libelleDeplacement} title={libelleDeplacement}
          {...deplacement} onKeyDown={(event) => {
            const destination: Partial<Record<string, ZonePanneau>> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };
            const bord = destination[event.key];
            if (bord) {
              event.preventDefault();
              flushSync(() => useLayoutStore.getState().deplacerEspaces(bord));
              document.querySelector<HTMLElement>(".sion-barre-espaces-poignee")?.focus();
            }
          }}><span className="sion-poignee-module" aria-hidden="true">⠿</span></div>
        <NavigationEspaces rail horizontal={horizontal} />
        <div className="sion-barre-espaces-outils">
          <hr className="sion-rail-separation" />
          <button className="sion-rail-bouton" aria-label={t("layout.toggleSidebar")} title={t("layout.toggleSidebar")} aria-expanded={mode === "full"}
            onClick={() => useLayoutStore.getState().toggleSidebar()}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 16h6V8h7v16h7v-8h6" />
            </svg>
          </button>
          {mode === "hidden" && <button type="button" className="sion-rail-bouton" data-panel-toggle
            aria-label={t("settings.account")} title={nom} onClick={() => useAppStore.getState().toggleAccountPanel()}>
            <UserAvatar name={nom} speaking={false} size="md" avatarUrl={credentials?.avatarUrl} />
          </button>}
          {isAdmin === true && <button className="sion-rail-bouton" data-panel-toggle aria-label={t("admin.title")} title={t("admin.title")} aria-pressed={showAdmin}
            onClick={() => useAppStore.getState().toggleAdmin()}>
            <ServerIcon />
            {pendingCount > 0 && <span className="sion-rail-compteur">{pendingCount}</span>}
          </button>}
          {mode === "hidden" && (
            <button className="sion-rail-bouton" data-panel-toggle aria-label={t("settings.title")} title={t("settings.title")} aria-pressed={showSettings}
              onPointerEnter={() => preloadHeavyScreens(0)} onClick={() => useAppStore.getState().toggleSettings()}>
              <SettingsIcon />
            </button>
          )}
        </div>
      </Bulle>
      <AccountPopover compact />
    </div>
  );
  // Les côtés occupent le bord de l'application, avant ou après le menu des salons.
  // Le portail conserve le chat et les panneaux montés pendant le déplacement.
  return <><span ref={ancrer} hidden />{!horizontal && cadre ? createPortal(navigation, cadre) : navigation}</>;
}
