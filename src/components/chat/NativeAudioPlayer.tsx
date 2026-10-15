import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSharedAudioContext } from "../../services/audioContext";
import { playNativeBuffer, type NativePlayback } from "../../services/nativeAudioPlayback";

/** Audio attachment decoded on first play, with native playback and position.
 *  Stream long recordings in chunks while preserving stereo. */
export function NativeAudioPlayer({ source }: { source: string }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [volume, setVolume] = useState(1);
  const volumeRef = useRef(1);
  const generation = useRef(0);
  const player = useRef<NativePlayback | null>(null);
  const decoded = useRef<Promise<AudioBuffer> | null>(null);

  useEffect(() => {
    decoded.current = null;
    const lifetime = generation;
    return () => { lifetime.current++; player.current?.stop(); player.current = null; };
  }, [source]);

  const stop = () => {
    generation.current++;
    player.current?.stop();
    player.current = null;
    setPlaying(false);
  };
  const start = async (from: number) => {
    stop();
    const current = generation.current;
    setFailed(false);
    setPlaying(true);
    try {
      decoded.current ??= fetch(source).then(async (response) => {
        if (!response.ok) throw new Error(`Audio: ${response.status}`);
        return getSharedAudioContext().decodeAudioData(await response.arrayBuffer());
      });
      const buffer = await decoded.current;
      if (generation.current !== current) return;
      setDuration(buffer.duration);
      const begin = from >= buffer.duration ? 0 : from;
      setPosition(begin);
      player.current = playNativeBuffer(buffer, begin, buffer.duration, {
        gain: volumeRef.current, allowDeafened: true,
        onTime: (time) => { if (generation.current === current) setPosition(time); },
        onEnd: () => { if (generation.current === current) setPlaying(false); },
        onError: () => { if (generation.current === current) setFailed(true); },
      });
      await player.current.ready;
    } catch {
      if (generation.current === current) { decoded.current = null; setFailed(true); setPlaying(false); }
    }
  };
  const format = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
    <button type="button" aria-label={t(playing ? "chat.pause" : "chat.play")} onClick={() => playing ? stop() : void start(position)}>
      {playing ? "⏸" : "▶"}
    </button>
    <input type="range" aria-label={t("chat.playbackPosition", { defaultValue: "Position de lecture" })}
      min={0} max={duration || 1} step={0.1} value={Math.min(position, duration || 1)} disabled={!duration}
      onChange={(event) => {
        const time = Number(event.target.value);
        setPosition(time);
        if (playing) void start(time);
      }} style={{ flex: 1, minWidth: 100 }} />
    <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{format(position)} / {format(duration)}</span>
    <input type="range" aria-label={t("chat.volume", { defaultValue: "Volume" })}
      min={0} max={1} step={0.05} value={volume}
      onChange={(event) => {
        const gain = Number(event.target.value);
        setVolume(gain);
        volumeRef.current = gain;
        player.current?.setGain(gain);
      }} style={{ width: 70 }} />
    {failed && <span role="alert" style={{ fontSize: 12 }}>{t("chat.audioPlayFailed", { defaultValue: "Impossible de lire cet audio" })}</span>}
  </div>;
}
