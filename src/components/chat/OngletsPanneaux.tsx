import { useTranslation } from "react-i18next";
import { MicIcon, SpeakerIcon } from "../icons";
import { useLayoutStore, type PanneauId } from "../../stores/useLayoutStore";

export function OngletsPanneaux({ salonVocal }: { salonVocal: boolean }) {
  const { t } = useTranslation();
  const panneau = useLayoutStore((s) => s.panneau);
  const basculer = useLayoutStore((s) => s.basculerPanneau);
  const onglets: { id: PanneauId; titre: string; icone: React.ReactNode }[] = [
    ...(salonVocal ? [{ id: "transcript" as const, titre: "transcript.title", icone: <MicIcon /> }] : []),
    { id: "soundboard", titre: "soundboard.title", icone: <SpeakerIcon /> },
    { id: "memeboard", titre: "memeboard.title", icone: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="4" /><path d="m10 9 5 3-5 3Z" /></svg> },
  ];
  return <div className="sion-onglets-panneaux" role="group" aria-label={t("layout.panels")}>
    {onglets.map(({ id, titre, icone }) => <button type="button" key={id} aria-label={t(titre)} title={t(titre)} aria-pressed={panneau === id} onClick={() => basculer(id)}>
      {icone}<span>{t(titre)}</span>
    </button>)}
  </div>;
}
