import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMatrixStore } from "../../stores/useMatrixStore";
import { useAppStore } from "../../stores/useAppStore";
import { useEspacesStore } from "../../stores/useEspacesStore";
import { useVoiceChannel } from "../../hooks/useVoiceChannel";
import { planDepartEspace } from "../../utils/departEspace";
import { EchecDepartEspace, quitterEspace } from "../../services/quitterEspace";
import { HashIcon, SoundboardIcon, SpeakerIcon, UsersIcon } from "../icons";

export function DepartEspace({ espaceId, action, onAnnuler }: {
  espaceId: string;
  action: (travail: () => Promise<void>) => Promise<void>;
  onAnnuler: () => void;
}) {
  const { t, i18n } = useTranslation(undefined, { bindI18n: "languageChanged loaded" });
  const channels = useMatrixStore((s) => s.channels);
  const hierarchies = useEspacesStore((s) => s.hierarchies);
  const vocal = useAppStore((s) => s.connectedVoiceChannel);
  const { leaveVoiceChannel } = useVoiceChannel();
  const [complet, setComplet] = useState(true);
  const [choix, setChoix] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (import.meta.env.DEV && i18n && !i18n.exists("spaces.leaveWithRooms")) void i18n.reloadResources().catch(() => {});
  }, [i18n]);
  const plan = planDepartEspace(channels, espaceId, hierarchies);
  const selection = complet ? plan.filter((p) => choix[p.salon.id] ?? !p.partageAvec.length) : [];
  const confirmer = () => action(async () => {
    try {
      await quitterEspace(espaceId, selection.map((p) => p.salon.id), leaveVoiceChannel,
        selection.filter((p) => p.partageAvec.length).map((p) => p.salon.id));
    } catch (e) {
      if (e instanceof EchecDepartEspace) {
        throw new Error(t(e.message, { rooms: e.salons.map((c) => c.name).join(", ") }));
      }
      throw e;
    }
  });
  return <div className="sion-depart-espace" data-depart-espace>
    <p>{t("spaces.leaveConfirm")}</p>
    <div className="sion-depart-options">
      <label><input type="radio" name="depart-espace" checked={complet} onChange={() => setComplet(true)} />
        <span><strong>{t("spaces.leaveWithRooms")}</strong><small>{t("spaces.leaveWithRoomsHelp")}</small></span></label>
      <label><input type="radio" name="depart-espace" checked={!complet} onChange={() => setComplet(false)} />
        <span><strong>{t("spaces.leaveOnly")}</strong><small>{t("spaces.leaveOnlyHelp")}</small></span></label>
    </div>
    {complet && <>
      <p>{t("spaces.leaveSelected", { count: selection.length })}</p>
      {plan.length > 0 ? <div className="sion-depart-liste">{plan.map(({ salon, partageAvec }) => {
        const Icone = salon.isSpace ? UsersIcon : salon.isSoundboard ? SoundboardIcon : salon.hasVoice ? SpeakerIcon : HashIcon;
        return <label className="sion-depart-ligne" key={salon.id}>
          <input type="checkbox" data-depart-salon={salon.id} checked={choix[salon.id] ?? !partageAvec.length}
            onChange={(e) => setChoix((c) => ({ ...c, [salon.id]: e.target.checked }))} />
          <Icone /><span><strong>{salon.name}</strong>
            {salon.isSoundboard && <small>{t("spaces.leaveLibrary")}</small>}
            {salon.isSpace && <small>{t("spaces.subspaces")}</small>}
            {partageAvec.length > 0 && <small>{t("spaces.leaveShared", { spaces: partageAvec.map((c) => c.name).join(", ") })}</small>}
          </span>
        </label>;
      })}</div> : <p>{t("spaces.leaveNoRooms")}</p>}
    </>}
    {vocal && selection.some((p) => p.salon.id === vocal) && <p>{t("spaces.leaveVoice")}</p>}
    <p>{t("spaces.leaveKeepDMs")}</p>
    <div className="sion-espaces-actions">
      <button type="button" className="sion-espaces-annuler" data-annuler-depart-espace onClick={onAnnuler}>{t("auth.cancel")}</button>
      <button type="button" className="sion-espaces-danger" data-confirmer-depart-espace onClick={() => void confirmer()}>{t("spaces.leave")}</button>
    </div>
  </div>;
}
