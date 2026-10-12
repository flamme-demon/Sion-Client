import { createContext } from "react";

export interface SelectionMessages {
  ids: ReadonlySet<string>;
  basculer: (id: string) => void;
  ajouter: (ids: string[]) => void;
}

export const SelectionMessagesContext = createContext<SelectionMessages | null>(null);
