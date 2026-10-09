import { useTranslation } from "react-i18next";
import { MicIcon, SoundboardIcon, MemeboardIcon } from "../icons";
import { useLayoutStore, type PanneauId } from "../../stores/useLayoutStore";

export function OngletsPanneaux({ salonVocal }: { salonVocal: boolean }) {
  const { t } = useTranslation();
  const panneaux = useLayoutStore((s) => s.panneaux);
  const basculer = useLayoutStore((s) => s.basculerPanneau);
  const onglets: { id: PanneauId; titre: string; icone: React.ReactNode }[] = [
    ...(salonVocal ? [{ id: "transcript" as const, titre: "transcript.title", icone: <MicIcon /> }] : []),
    { id: "soundboard", titre: "soundboard.title", icone: <SoundboardIcon /> },
    { id: "memeboard", titre: "memeboard.title", icone: <MemeboardIcon /> },
  ];
  return <div className="sion-onglets-panneaux" role="group" aria-label={t("layout.panels")}>
    {onglets.map(({ id, titre, icone }) => <button type="button" key={id} aria-label={t(titre)} title={t(titre)} aria-pressed={panneaux.includes(id)} onClick={() => basculer(id)}>
      {icone}<span>{t(titre)}</span>
    </button>)}
  </div>;
}
