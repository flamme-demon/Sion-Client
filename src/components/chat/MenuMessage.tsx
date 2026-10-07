import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ActionMenuMessage {
  label: string;
  icon?: ReactNode;
  action: () => void;
  close?: boolean;
  tone?: "primary" | "error";
  pressed?: boolean;
}

export function MenuMessage({ x, y, actions, onClose }: {
  x: number;
  y: number;
  actions: ActionMenuMessage[];
  onClose: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y, actions.length]);

  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
  useEffect(() => {
    const dehors = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const echap = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(true); };
    const redimensionner = () => onClose();
    const defiler = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", dehors);
    window.addEventListener("keydown", echap);
    window.addEventListener("scroll", defiler, true);
    window.addEventListener("resize", redimensionner);
    return () => {
      window.removeEventListener("mousedown", dehors);
      window.removeEventListener("keydown", echap);
      window.removeEventListener("scroll", defiler, true);
      window.removeEventListener("resize", redimensionner);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="sion-menu-message" role="menu"
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={(event) => {
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number;
        if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
        else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[next]?.focus();
      }}
      style={{
        position: "fixed", left: pos.left, top: pos.top, zIndex: 10001,
        minWidth: 208, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", overflowY: "auto",
        padding: 4, background: "var(--color-surface-container-high)", borderRadius: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}>
      {actions.map(({ label, icon, action, close = true, tone, pressed }) => (
        <button key={label} type="button" role={pressed === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={pressed} onClick={() => { if (close) onClose(); action(); }}
          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--color-surface-container-highest)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px",
            border: "none", borderRadius: 8, background: "transparent", cursor: "pointer",
            color: tone ? `var(--color-${tone})` : "var(--color-on-surface)",
            fontSize: 13, fontFamily: "inherit", textAlign: "left",
          }}>
          {icon}{label}
        </button>
      ))}
    </div>, document.body,
  );
}
