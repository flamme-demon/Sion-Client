import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ImageCropper } from "../chat/ImageCropper";
import { ImageIcon } from "../icons";

function ApercuLogo({ image, description }: { image: File; description: string }) {
  const apercu = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(image);
    if (apercu.current) apercu.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [image]);
  return <img ref={apercu} alt={description} />;
}

function RecadrageLogo({ fichier, onCancel, onCropped }: {
  fichier: File; onCancel: () => void; onCropped: (image: File) => void;
}) {
  const { t } = useTranslation();
  const dialogue = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null;
    dialogue.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus();
    return () => { if (origine?.isConnected) origine.focus(); };
  }, []);
  return createPortal(<div ref={dialogue} role="dialog" aria-modal="true" aria-label={t("cropper.title")}
    onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if (e.key === "Tab") {
        const elements = Array.from(dialogue.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
        const premier = elements[0], dernier = elements.at(-1);
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier?.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier?.focus(); }
      }
    }}>
    <ImageCropper file={fichier} round={false} onCancel={onCancel} onCropped={onCropped} />
  </div>, document.body);
}

export function ChoixLogoEspace({ image, imageActuelle, onChange }: {
  image: File | undefined; imageActuelle?: string; onChange: (image: File) => void;
}) {
  const { t } = useTranslation();
  const fichier = useRef<HTMLInputElement>(null);
  const [aRecadrer, setARecadrer] = useState<File | null>(null);
  return <>
    <div className="sion-espaces-logo-champ">
      <span>{t("spaces.logo")}</span>
      <button type="button" className="sion-espaces-logo" onClick={() => fichier.current?.click()}>
        <span className="sion-espaces-logo-icone">
          {image ? <ApercuLogo image={image} description={t("spaces.logoPreview")} />
            : imageActuelle ? <img src={imageActuelle} alt={t("spaces.logoPreview")} /> : <ImageIcon />}
        </span>
        <span><strong>{t(image || imageActuelle ? "spaces.changeLogo" : "spaces.chooseLogo")}</strong>
          <small>{image?.name ?? t(imageActuelle ? "spaces.currentLogo" : "spaces.noLogo")}</small></span>
      </button>
      <input ref={fichier} hidden type="file" accept="image/*" aria-label={t("spaces.logo")}
        onChange={(e) => {
          const source = e.target.files?.[0];
          e.target.value = "";
          if (source) setARecadrer(source);
        }} />
    </div>
    {aRecadrer && <RecadrageLogo fichier={aRecadrer} onCancel={() => setARecadrer(null)} onCropped={(resultat) => {
      onChange(new File([resultat], `${aRecadrer.name.replace(/\.[^.]+$/, "")}.jpg`, { type: resultat.type }));
      setARecadrer(null);
    }} />}
  </>;
}
