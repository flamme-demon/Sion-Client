import type { CSSProperties, ReactNode } from "react";
import type { BackgroundScope } from "../../stores/useLayoutStore";
import { BackgroundControls, PanelBackgroundLayer } from "./PanelBackground";

export interface BulleProps {
  as?: "aside" | "main" | "nav" | "section";
  scope?: BackgroundScope;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  "aria-label"?: string;
}

/** Contenant commun, isolé pour que les fonds restent sous les messages. */
export function Bulle({ as: Tag = "section", scope, className = "", style, children, "aria-label": label }: BulleProps) {
  return (
    <Tag className={`sion-bulle ${className}`} aria-label={label} style={{ isolation: "isolate", ...style }}>
      {scope && <PanelBackgroundLayer scope={scope} />}
      {scope && <BackgroundControls scope={scope} />}
      {children}
    </Tag>
  );
}
