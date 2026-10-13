import { act } from "react";
import { expect, it } from "vitest";
import { montage } from "../../test/interface";
import { ImageAvatar } from "./ImageAvatar";

const vue = montage();
const echouer = async () => {
  const image = vue.container.querySelector('img')!;
  await act(async () => image.dispatchEvent(new Event('error')));
};

it("essaie l'original d'une miniature fédérée et conserve ce choix au remontage", async () => {
  const src = 'sion-media://localhost/avatar-a?avatar=1';
  await vue.render(<ImageAvatar src={src} alt="Alice" fallback="A" />);
  await echouer();
  expect(vue.container.querySelector('img')?.getAttribute('src')).toBe('sion-media://localhost/avatar-a');
  await vue.render(<></>);
  await vue.render(<ImageAvatar src={src} alt="Alice" fallback="A" />);
  expect(vue.container.querySelector('img')?.getAttribute('src')).toBe('sion-media://localhost/avatar-a');
  await echouer();
  expect(vue.container.querySelector('img')).toBeNull();
  expect(vue.container.textContent).toBe('A');
});

it("traite les protocoles Windows et Android et repart sur un nouvel avatar", async () => {
  await vue.render(<ImageAvatar src="http://sion-media.localhost/avatar-b?avatar=1" alt="Bob" fallback="B" />);
  await echouer();
  expect(vue.container.querySelector('img')?.getAttribute('src')).toBe('http://sion-media.localhost/avatar-b');
  await echouer();
  expect(vue.container.textContent).toBe('B');
  await vue.render(<ImageAvatar src="https://exemple.fr/bob.png" alt="Bob" fallback="B" />);
  expect(vue.container.querySelector('img')?.getAttribute('src')).toBe('https://exemple.fr/bob.png');
});

it("n'altère pas les URL externes et affiche l'initiale sans boucle de reprise", async () => {
  await vue.render(<ImageAvatar src="https://exemple.fr/photo?avatar=1" alt="Photo" fallback="P" />);
  await echouer();
  expect(vue.container.querySelector('img')).toBeNull();
  expect(vue.container.textContent).toBe('P');
});
