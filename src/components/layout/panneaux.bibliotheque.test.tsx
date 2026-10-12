import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { PANNEAU_CORPS } from "./panneaux";
import { ContexteBoard } from "../chat/ContexteBoard";
import { useBibliothequeActive } from "../../hooks/useBibliothequeActive";
import type { Channel } from "../../types/matrix";

vi.mock("../../i18n", () => ({ default: { t: (key: string) => key, changeLanguage: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options?: Record<string, string>) => (options?.defaultValue ?? key)
    .replace(/{{(\w+)}}/g, (_, cle: string) => options?.[cle] ?? ""),
}) }));
// Remplacer uniquement le contenu lourd. Le choix et le cycle de vie des
// bibliothèques, les stores et le libellé sont ceux de l'application.
vi.mock("../chat/SoundboardPanel", async () => {
  const { useState } = await import("react");
  return { SoundboardPanel: function Sons() {
    const [selection, choisir] = useState(0);
    return <button data-selection onClick={() => choisir(selection + 1)}>{selection}</button>;
  } };
});
vi.mock("../chat/MemeboardPanel", async () => {
  const { useState } = await import("react");
  return { MemeboardPanel: function Memes() {
    const [selection, choisir] = useState(0);
    return <button data-selection onClick={() => choisir(selection + 1)}>{selection}</button>;
  } };
});
const salon = (id: string, reste: Partial<Channel> = {}): Channel => ({
  id, name: id, hasVoice: false, voiceUsers: [], createdAt: 0, lastActivity: 0, ...reste,
});
const vue = montage();
beforeEach(() => {
  useMatrixStore.setState({ currentUserId: "@alice:example.org", channels: [
    salon("!sion", { name: "Sion", isSpace: true, spaceChildren: ["!vocal"], boardRoomId: "!board" }),
    salon("!manjaro", { name: "Manjaro", isSpace: true, spaceChildren: ["!general"] }),
    salon("!vocal", { name: "Général", hasVoice: true }), salon("!general"),
  ] });
  useEspacesStore.setState({ espaceActif: "!sion", hierarchies: {} });
  useAppStore.setState({ connectedVoiceChannel: "!vocal" });
});

it.each(["soundboard", "memeboard"] as const)(
  "%s conserve son contenu pendant la navigation et change de source à la fin du vocal", async (id) => {
    const Corps = PANNEAU_CORPS[id];
    await vue.render(<><ContexteBoard /><Corps /></>);
    await vue.click("[data-selection]");
    expect(vue.container.querySelector("[data-contexte-board]")?.textContent).toBe("Vocal · Sion");
    await act(async () => useEspacesStore.getState().choisir("!manjaro"));
    expect(vue.container.querySelector("[data-selection]")?.textContent).toBe("1");
    expect(vue.container.querySelector("[data-contexte-board]")?.textContent).toBe("Vocal · Sion");
    expect(vue.container.querySelector("[data-contexte-board]")?.getAttribute("title"))
      .toContain("vocal Général");
    await act(async () => useAppStore.setState({ connectedVoiceChannel: null }));
    expect(vue.container.querySelector("[data-selection]")?.textContent).toBe("0");
    expect(vue.container.querySelector("[data-contexte-board]")?.textContent).toBe("Manjaro");
  });

it("un changement de compte recharge les boards même dans le même espace", async () => {
  const Corps = PANNEAU_CORPS.soundboard;
  await vue.render(<Corps />);
  await vue.click("[data-selection]");
  await act(async () => useMatrixStore.setState({ currentUserId: "@bob:example.org" }));
  expect(vue.container.querySelector("[data-selection]")?.textContent).toBe("0");
});

it("la présence des membres ne provoque pas de rendu des consommateurs de la bibliothèque", async () => {
  let rendus = 0;
  function Source() {
    const contexte = useBibliothequeActive();
    rendus++;
    return <span>{contexte.espaceNom}</span>;
  }
  await vue.render(<Source />);
  const avant = rendus;
  await act(async () => useMatrixStore.setState({ channels: useMatrixStore.getState().channels.map((c) => ({
    ...c, voiceUsers: [{ id: "@bob:example.org", name: "Bob", role: "user", speaking: true, muted: false, deafened: false }],
  })) }));
  expect(rendus).toBe(avant);
});
