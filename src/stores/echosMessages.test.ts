import { expect, it } from "vitest";
import type { ChatMessage } from "../types/matrix";
import { confirmerEcho, fusionnerEchos } from "./echosMessages";

const echo = (transactionId = "t1"): ChatMessage => ({
  id: `~${transactionId}`, transactionId, localEcho: true, sending: true,
  senderId: "@moi:hs", user: "Moi", role: "user", time: "12:00", ts: 1,
  text: "https://store.steampowered.com/app/4536610/City_Masterplan/",
});
const recu = (eventId = "$1", transactionId = "t1"): ChatMessage => ({
  ...echo(transactionId), id: eventId, eventId, localEcho: undefined, sending: undefined,
});

it("conserve l'envoi pendant une publication sans son retour", () => {
  const local = echo();
  const autre = recu("$autre", "autre");
  expect(fusionnerEchos([local], [autre])).toEqual([autre, local]);
});

it("la synchro arrivée avant l'accusé remplace l'écho par sa transaction", () => {
  const serveur = recu();
  const fusion = fusionnerEchos([echo()], [serveur]);
  expect(fusion).toEqual([serveur]);
  expect(confirmerEcho(fusion, "t1", "$1")).toBe(fusion);
});

it("l'accusé arrivé avant la synchro garde le message, puis le remplace par son ID", () => {
  const confirme = confirmerEcho([echo()], "t1", "$1");
  expect(confirme[0]).toMatchObject({ id: "$1", eventId: "$1", sending: false, localEcho: true });
  expect(fusionnerEchos(confirme, [])).toEqual(confirme);
  const serveur = { ...recu(), transactionId: undefined };
  expect(fusionnerEchos(confirme, [serveur])).toEqual([serveur]);
  // Une suppression ultérieure ne ressuscite pas l'écho.
  expect(fusionnerEchos([serveur], [])).toEqual([]);
});

it("deux textes identiques restent deux envois distincts", () => {
  const deuxieme = echo("t2");
  expect(fusionnerEchos([echo(), deuxieme], [recu()])).toEqual([recu(), deuxieme]);
});

it("la transaction d'un autre auteur ne confirme pas notre envoi", () => {
  const autre = { ...recu(), senderId: "@autre:hs" };
  expect(fusionnerEchos([echo()], [autre])).toEqual([autre, echo()]);
});

it("l'accusé supprime un écho si son événement est déjà présent sans transaction", () => {
  const serveur = { ...recu(), transactionId: undefined };
  expect(confirmerEcho([serveur, echo()], "t1", "$1")).toEqual([serveur]);
});
