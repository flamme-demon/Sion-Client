import { act, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { ChoixLogoEspace } from "./ChoixLogoEspace";

const appels = vi.hoisted(() => ({ modifier: vi.fn(), creerUrl: vi.fn(), libererUrl: vi.fn(), toucheParent: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (cle: string) => cle }) }));
vi.mock("../chat/ImageCropper", () => ({ ImageCropper: ({ file, round, onCancel, onCropped }: {
  file: File; round: boolean; onCancel: () => void; onCropped: (file: File) => void;
}) => <div data-overlay="true"><input type="range" aria-label="Zoom" /><span>{round ? "rond" : "carré"}</span>
  <button type="button" onClick={onCancel}>Annuler le recadrage</button>
  <button type="button" onClick={() => onCropped(new File([file], "portrait.jpg", { type: "image/jpeg" }))}>Recadrer</button>
</div> }));
const vue = montage();
beforeEach(() => {
  appels.modifier.mockReset(); appels.toucheParent.mockReset();
  appels.creerUrl.mockReset().mockImplementation((f: File) => `blob:${f.name}`);
  appels.libererUrl.mockReset();
  const Url = globalThis.URL;
  vi.stubGlobal("URL", class extends Url { static createObjectURL = appels.creerUrl; static revokeObjectURL = appels.libererUrl; });
});
function Formulaire({ imageActuelle }: { imageActuelle?: string }) {
  const [image, setImage] = useState<File>();
  return <form onKeyDown={appels.toucheParent}><ChoixLogoEspace image={image} imageActuelle={imageActuelle}
    onChange={(f) => { appels.modifier(f); setImage(f); }} /></form>;
}
async function choisir(nom = "équipe.png") {
  await act(async () => {
    const input = vue.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], nom, { type: "image/png" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function recadrer() {
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-overlay] button')).find((b) => b.textContent === "Recadrer")!.click());
}
it("ouvre le recadreur carré dans un portail et affiche le logo confirmé, plutôt que le fichier brut", async () => {
  await vue.render(<Formulaire />);
  await choisir();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("carré");
  expect(vue.container.contains(document.querySelector('[data-overlay]'))).toBe(false);
  expect(appels.modifier).not.toHaveBeenCalled();
  expect(vue.container.querySelector('img')).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Zoom");
  await recadrer();
  expect(appels.modifier).toHaveBeenCalledOnce();
  const image = appels.modifier.mock.calls[0][0] as File;
  expect(image.name).toBe("équipe.jpg"); expect(image.type).toBe("image/jpeg");
  expect(vue.container.querySelector('img')?.getAttribute("src")).toBe("blob:équipe.jpg");
  expect(document.querySelector('[data-overlay]')).toBeNull();
});
it("montre le logo existant et Escape annule seulement le recadrage en conservant le nouvel aperçu", async () => {
  await vue.render(<Formulaire imageActuelle="https://example.test/logo.png" />);
  expect(vue.container.querySelector('img')?.getAttribute("src")).toBe("https://example.test/logo.png");
  await choisir(); await recadrer();
  await choisir("autre.png");
  await act(async () => document.querySelector('[data-overlay] input')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[data-overlay]')).toBeNull();
  expect(appels.toucheParent).not.toHaveBeenCalled();
  expect(appels.modifier).toHaveBeenCalledOnce();
  expect(vue.container.querySelector('img')?.getAttribute("src")).toBe("blob:équipe.jpg");
});
it("libère les aperçus remplacés et ferme le cycle des URL à la fermeture du formulaire", async () => {
  await vue.render(<Formulaire />);
  await choisir(); await recadrer();
  await choisir("nouveau.png"); await recadrer();
  expect(appels.libererUrl).toHaveBeenCalledExactlyOnceWith("blob:équipe.jpg");
  await vue.render(null);
  expect(appels.libererUrl.mock.calls).toEqual([["blob:équipe.jpg"], ["blob:nouveau.jpg"]]);
});
