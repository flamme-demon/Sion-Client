import { CarteProfil } from "./CarteProfil";

export function UserControls({ compact = false }: { compact?: boolean }) {
  return <CarteProfil compact={compact} />;
}
