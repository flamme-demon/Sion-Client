import { act, StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Les stores lisent localStorage dès leur import (même préparation que
// NativeAudioSettings.test.tsx).
vi.hoisted(() => {
  const valeurs = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur); },
    removeItem: (cle: string) => { valeurs.delete(cle); },
  } });
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string) => cle }) }));

// Le rendu des messages n'est pas l'objet du test : seule compte la logique
// de lecture de la liste.
vi.mock("./Message", () => ({
  Message: ({ children, enMosaique }: { children?: ReactNode; enMosaique?: boolean }) => <div data-case-image={enMosaique || undefined}>{children}</div>,
  GalerieImagesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./LecteursMessage", () => ({ LecteursMessage: () => null }));
const affichage = vi.hoisted(() => ({ mobile: false }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => affichage.mobile }));

import { MessageList } from "./MessageList";
import { reinitialiserPresence } from "../../services/premierPlan";
import { useAppStore } from "../../stores/useAppStore";
import { useMatrixStore } from "../../stores/useMatrixStore";
import type { ChatMessage } from "../../types/matrix";

const SALON = "!chihuahuatistant:sion.test";

function message(id: string, expediteur: string, ts: number): ChatMessage {
  return { id, eventId: id, senderId: expediteur, user: expediteur, role: "user", text: id, time: "", ts } as ChatMessage;
}

function ajouter(m: ChatMessage) {
  act(() => {
    useMatrixStore.setState((s) => ({ messages: { ...s.messages, [SALON]: [...(s.messages[SALON] ?? []), m] } }));
  });
}

it("un écho en cours d'envoi ne devient pas un identifiant de lecture", () => {
  act(() => vi.advanceTimersByTime(6000));
  ajouter({ ...message("~transaction", "@flamme:sion.test", Date.now()), eventId: undefined, sending: true, localEcho: true });
  act(() => vi.advanceTimersByTime(100));
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$1");
});

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  affichage.mobile = false;
  vi.useFakeTimers();
  // Présence commune (premierPlan) : chaque test part d'un utilisateur là.
  reinitialiserPresence();
  // Images d'animation au rythme des minuteurs simulés.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  // Quelqu'un est devant l'écran (voir « Présence » dans MessageList).
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  // jsdom n'a ni ResizeObserver ni mise en page : tout est « en bas du fil ».
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useMatrixStore.setState({
    currentUserId: "@flamme:sion.test",
    messages: { [SALON]: [message("$1", "@picsou:sion.test", 1)] },
    roomHasMore: { [SALON]: false },
    roomLoadingHistory: {},
  });
  useAppStore.setState({ activeChannel: SALON, lastReadMessageId: {}, mobileView: "chat" });
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(<MessageList />));
});

it("le chat conservé derrière la navigation mobile ne lit pas les messages masqués", () => {
  affichage.mobile = true;
  act(() => racine.render(<MessageList />));
  act(() => vi.advanceTimersByTime(6000));
  const fil = conteneur.querySelector(".sion-messages");
  for (const mobileView of ["channels", "sidebar"] as const) {
    act(() => useAppStore.setState({ mobileView }));
    act(() => vi.advanceTimersByTime(10));
    ajouter(message(`$${mobileView}`, "@narkow:sion.test", Date.now()));
    act(() => vi.advanceTimersByTime(100));
    expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$1");
  }
  act(() => useAppStore.setState({ mobileView: "chat" }));
  act(() => vi.advanceTimersByTime(100));
  defiler(600);
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$sidebar");
  expect(conteneur.querySelector(".sion-messages")).toBe(fil);
});

it.each([0, 32, 62])("cancels pending initial positioning when the chat closes at %d ms", (delay) => {
  act(() => vi.advanceTimersByTime(delay));
  const frame = vi.spyOn(globalThis, "requestAnimationFrame");
  act(() => racine.render(null));
  const reads = useAppStore.getState().lastReadMessageId;
  act(() => vi.advanceTimersByTime(200));
  expect(frame).not.toHaveBeenCalled();
  expect(useAppStore.getState().lastReadMessageId).toBe(reads);
});

it("does not mark the previous room as read when switching before initial positioning", () => {
  act(() => vi.advanceTimersByTime(32));
  const otherRoom = "!other:sion.test";
  act(() => {
    useMatrixStore.setState((s) => ({ messages: { ...s.messages, [otherRoom]: [message("$other", "@alice:sion.test", 1)] } }));
    useAppStore.setState({ activeChannel: otherRoom });
  });
  act(() => vi.advanceTimersByTime(200));
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBeUndefined();
  expect(useAppStore.getState().lastReadMessageId[otherRoom]).toBe("$other");
});

it("positions the chat after Strict Mode replays mount effects", () => {
  act(() => racine.render(<StrictMode><MessageList /></StrictMode>));
  act(() => vi.advanceTimersByTime(200));
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$1");
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("la mosaïque conserve les identifiants de tous les événements et s'arrête aux non-lus", () => {
  const photos = [1, 2, 3, 4].map((id) => ({ ...message(`$photo${id}`, "@element:matrix.org", Date.now() + id), text: "",
    attachments: [{ id: String(id), name: "photo.png", mimeType: "image/png", size: 0, url: "https://media.invalid/photo" }] }));
  const AUTRE = "!photos:sion.test";
  act(() => {
    useMatrixStore.setState((s) => ({ messages: { ...s.messages, [AUTRE]: photos }, roomHasMore: { [AUTRE]: false } }));
    useAppStore.setState({ lastReadMessageId: { [AUTRE]: "$photo2" }, activeChannel: AUTRE });
  });
  expect(Array.from(conteneur.querySelectorAll('[data-event-id]')).map((e) => e.getAttribute("data-event-id"))).toEqual(photos.map((p) => p.eventId));
  expect(conteneur.querySelectorAll(".sion-mosaique")).toHaveLength(2);
  expect(conteneur.querySelectorAll('[data-case-image="true"]')).toHaveLength(4);
  expect(conteneur.querySelector('[data-unread-sep]')?.closest('.sion-mosaique')).toBeNull();
});

it("affiche une seule légende sous les images de l’album, dans la mosaïque", () => {
  const photos = [1, 2, 3].map((id) => ({ ...message(`$photo${id}`, "@element:matrix.org", Date.now() + id), text: id === 1 ? "Pour avoir la bêta !" : "",
    attachments: [{ id: String(id), name: "photo.png", mimeType: "image/png", size: 0, url: "https://media.invalid/photo" }] }));
  act(() => useMatrixStore.setState({ messages: { [SALON]: photos } }));
  const mosaïque = conteneur.querySelector(".sion-mosaique")!;
  expect(mosaïque.querySelectorAll('[data-case-image="true"]')).toHaveLength(3);
  expect(mosaïque.querySelector(".sion-mosaique-legende")?.textContent).toContain("Pour avoir la bêta !");
  expect(mosaïque.textContent?.match(/Pour avoir la bêta !/g)).toHaveLength(1);
});

it("un message reçu en bas du fil est lu, même si le fil a bougé juste après l'ouverture du salon", () => {
  // Les fils du démarrage arrivent dans les 5 premières secondes.
  ajouter(message("$2", "@picsou:sion.test", 2));
  act(() => vi.advanceTimersByTime(6000));

  // Bien plus tard, Narkow écrit ; on regarde le salon, en bas du fil.
  ajouter(message("$3", "@narkow:sion.test", 3));
  act(() => vi.advanceTimersByTime(100));

  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$3");
});

it("à l'ouverture, remonte l'historique jusqu'au dernier lu pour afficher le bandeau des non-lus", () => {
  const AUTRE = "!limonadistant:sion.test";
  const anciens = [message("$10", "@narkow:sion.test", 10), message("$11", "@picsou:sion.test", 11)];
  const recents = [20, 21, 22, 23].map((ts) => message(`$${ts}`, "@narkow:sion.test", ts));
  // Le dernier lu ($10) n'est pas chargé : seule une remontée le ramène.
  const charger = vi.fn(async (salon: string) => {
    useMatrixStore.setState((s) => ({
      messages: { ...s.messages, [salon]: [...anciens, ...(s.messages[salon] ?? [])] },
      roomHasMore: { ...s.roomHasMore, [salon]: false },
    }));
  });
  useMatrixStore.setState((s) => ({
    messages: { ...s.messages, [AUTRE]: recents },
    roomHasMore: { ...s.roomHasMore, [AUTRE]: true },
    loadRoomHistory: charger,
  }));
  useAppStore.setState({ lastReadMessageId: { [AUTRE]: "$10" } });

  act(() => useAppStore.setState({ activeChannel: AUTRE }));
  act(() => vi.advanceTimersByTime(200));

  expect(charger).toHaveBeenCalledWith(AUTRE);
  expect(conteneur.querySelector("[data-unread-sep]")).not.toBeNull();
});

it("charge les messages d'un salon vide même si le cœur a déjà annoncé qu'il reste de l'historique", async () => {
  const MANJARO = "!manjaro:matrix.org";
  let terminer!: () => void;
  const charger = vi.fn(async (salon: string) => {
    useMatrixStore.setState((s) => ({ roomLoadingHistory: { ...s.roomLoadingHistory, [salon]: true } }));
    await new Promise<void>((resolve) => { terminer = resolve; });
    useMatrixStore.setState((s) => ({
      messages: { ...s.messages, [salon]: [message("$manjaro", "@alice:matrix.org", 1)] },
      roomHasMore: { ...s.roomHasMore, [salon]: true },
      roomLoadingHistory: { ...s.roomLoadingHistory, [salon]: false },
    }));
  });
  await act(async () => {
    useMatrixStore.setState((s) => ({ messages: { ...s.messages, [MANJARO]: [] }, roomHasMore: { ...s.roomHasMore, [MANJARO]: true }, loadRoomHistory: charger }));
    useAppStore.setState({ activeChannel: MANJARO, lastReadMessageId: {} });
  });
  expect(charger).toHaveBeenCalledOnce();
  expect(charger).toHaveBeenCalledWith(MANJARO);
  expect(conteneur.textContent).toContain("chat.loading");
  await act(async () => terminer());
  expect(conteneur.querySelector('[data-event-id="$manjaro"]')).not.toBeNull();
  expect(charger).toHaveBeenCalledOnce();
});

it("un chargement resté vide ne tourne pas en boucle et peut être retenté à la prochaine visite", async () => {
  const VIDE = "!vide:matrix.org";
  const charger = vi.fn(async (salon: string) => {
    useMatrixStore.setState((s) => ({ roomLoadingHistory: { ...s.roomLoadingHistory, [salon]: true } }));
    await Promise.resolve();
    useMatrixStore.setState((s) => ({ roomLoadingHistory: { ...s.roomLoadingHistory, [salon]: false } }));
  });
  await act(async () => {
    useMatrixStore.setState((s) => ({ messages: { ...s.messages, [VIDE]: [] }, roomHasMore: { ...s.roomHasMore, [VIDE]: true }, loadRoomHistory: charger }));
    useAppStore.setState({ activeChannel: VIDE, lastReadMessageId: {} });
  });
  expect(charger).toHaveBeenCalledOnce();
  await act(async () => useMatrixStore.setState({ pinnedVersion: 1 }));
  expect(charger).toHaveBeenCalledOnce();
  await act(async () => useAppStore.setState({ activeChannel: SALON }));
  await act(async () => useAppStore.setState({ activeChannel: VIDE }));
  expect(charger).toHaveBeenCalledTimes(2);
});

/** Géométrie simulée du fil (jsdom n'a pas de mise en page), puis un
 *  évènement de défilement comme en produit la molette. */
function defiler(scrollTop: number, scrollHeight = 1000, clientHeight = 400) {
  const fil = conteneur.querySelector<HTMLElement>(".overflow-y-auto")!;
  Object.defineProperty(fil, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(fil, "clientHeight", { configurable: true, get: () => clientHeight });
  Object.defineProperty(fil, "scrollTop", { configurable: true, get: () => scrollTop, set: () => {} });
  act(() => { fil.dispatchEvent(new Event("scroll")); });
}

it("absent, un message reçu n'est pas lu ; au retour il faut descendre pour le lire", () => {
  act(() => vi.advanceTimersByTime(6000));
  // On quitte la fenêtre de Sion (autre application).
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  act(() => { window.dispatchEvent(new Event("blur")); });

  ajouter(message("$2", "@narkow:sion.test", 2));
  act(() => vi.advanceTimersByTime(100));
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$1");
  expect(conteneur.querySelector("[data-unread-sep]")).not.toBeNull();
  // La vue s'est arrêtée sur le bandeau, le nouveau message plus bas.
  defiler(500);

  // Retour : le message n'est pas encore sous les yeux.
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event("focus")); });
  act(() => vi.advanceTimersByTime(100));
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$1");

  // On descend : lu, et le bandeau reste…
  defiler(600);
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$2");
  expect(conteneur.querySelector("[data-unread-sep]")).not.toBeNull();

  // …puis disparaît 5 s après, puisque tout est lu — même si la vue a été
  // ramenée plus haut entre-temps (bandeau replacé, image qui finit de
  // charger) : l'ancienne règle attendait un nouveau retour en bas.
  defiler(500);
  act(() => vi.advanceTimersByTime(5100));
  expect(conteneur.querySelector("[data-unread-sep]")).toBeNull();
});

it("sans souris ni clavier depuis une minute, un message reçu n'est pas lu (fil qui tient à l'écran)", () => {
  act(() => vi.advanceTimersByTime(61_000));
  ajouter(message("$2", "@narkow:sion.test", 2));
  act(() => vi.advanceTimersByTime(100));
  expect(useAppStore.getState().lastReadMessageId[SALON]).not.toBe("$2");

  // La souris bouge : on est de retour, en bas du fil.
  act(() => { window.dispatchEvent(new Event("pointermove")); });
  act(() => vi.advanceTimersByTime(100));
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$2");
});

it("absent, une réponse partie depuis la notification ne vaut pas lecture du salon", () => {
  act(() => vi.advanceTimersByTime(6000));
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  act(() => { window.dispatchEvent(new Event("blur")); });

  ajouter(message("$2", "@narkow:sion.test", 2));
  act(() => vi.advanceTimersByTime(100));
  expect(conteneur.querySelector("[data-unread-sep]")).not.toBeNull();

  // 29/09 : réponse depuis la notification de KDE, on est toujours ailleurs.
  // Mon message arrive dans le fil : il ne prouve pas qu'on a lu le salon.
  ajouter(message("$3", "@flamme:sion.test", Date.now()));
  act(() => vi.advanceTimersByTime(100));
  expect(conteneur.querySelector("[data-unread-sep]")).not.toBeNull();
  expect(useAppStore.getState().lastReadMessageId[SALON]).toBe("$1");
});
