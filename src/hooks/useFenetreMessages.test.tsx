import { useCallback, useRef } from "react";
import { expect, it } from "vitest";
import { montage } from "../test/interface";
import type { ChatMessage } from "../types/matrix";
import { useFenetreMessages } from "./useFenetreMessages";

const vue = montage();
const messages = (debut: number, fin: number) => Array.from({ length: fin - debut }, (_, i) => ({ id: debut + i, eventId: `$${debut + i}`, text: '', user: 'Alice', time: '' } as ChatMessage));
function Fil({ salon = '!un', liste, cible = -1 }: { salon?: string; liste: ChatMessage[]; cible?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lire = useCallback(() => ref.current, []);
  const { debut, afficherPlus } = useFenetreMessages(salon, liste, cible, lire);
  return <div ref={ref} data-debut={debut}>
    <button onClick={afficherPlus}>Précédents</button>
    {liste.slice(debut).map(m => <div key={m.id} data-message={m.id} />)}
  </div>;
}
const ids = () => Array.from(vue.container.querySelectorAll('[data-message]')).map(e => Number(e.getAttribute('data-message')));

it("ouvre la partie récente, conserve la vue lors d'un nouveau message et réinitialise au changement de salon", async () => {
  await vue.render(<Fil liste={messages(0, 300)} />);
  expect(ids()).toHaveLength(60);
  expect(ids()[0]).toBe(240);
  await vue.render(<Fil liste={messages(0, 301)} />);
  expect(ids()[0]).toBe(240);
  expect(ids().at(-1)).toBe(300);
  await vue.render(<Fil salon="!deux" liste={messages(1000, 1200)} />);
  expect(ids()[0]).toBe(1140);
});

it("remonte les pages en mémoire en gardant le contenu à la même position", async () => {
  await vue.render(<Fil liste={messages(0, 300)} />);
  const fil = vue.container.firstElementChild as HTMLElement;
  Object.defineProperty(fil, 'scrollHeight', { configurable: true, get: () => ids().length * 50 });
  fil.scrollTop = 50;
  await vue.click('button');
  expect(ids()[0]).toBe(180);
  expect(fil.scrollTop).toBe(3050);
  for (let i = 0; i < 3; i++) await vue.click('button');
  expect(ids()[0]).toBe(0);
  await vue.render(<Fil liste={messages(-30, 300)} />);
  expect(ids()[0]).toBe(-30);
});

it("inclut un ancien message ciblé et son contexte sans pagination réseau", async () => {
  await vue.render(<Fil liste={messages(0, 300)} />);
  await vue.render(<Fil liste={messages(0, 300)} cible={42} />);
  expect(ids()[0]).toBe(41);
  expect(ids()).toContain(42);
});

it("garde l'ancre si le serveur ajoute une page au-dessus, et l'oublie si les messages sont purgés", async () => {
  await vue.render(<Fil liste={messages(0, 300)} />);
  await vue.render(<Fil liste={messages(-30, 300)} />);
  expect(ids()[0]).toBe(240);
  await vue.render(<Fil liste={messages(300, 310)} />);
  expect(ids()).toEqual(Array.from({ length: 10 }, (_, i) => 300 + i));
});
