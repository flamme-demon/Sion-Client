import { describe, expect, it } from "vitest";
import { audioBufferToNativePcm } from "./nativeAudioPcm";

function buffer(channels: number[][], sampleRate = 48_000): AudioBuffer {
  return {
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (index: number) => Float32Array.from(channels[index]),
  } as AudioBuffer;
}

function samples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true));
}

describe("PCM natif commun aux cues et à la soundboard", () => {
  it("mixe la stéréo en mono et sature les valeurs hors plage", () => {
    expect(samples(audioBufferToNativePcm(buffer([
      [-1, 0.5, 3, -3],
      [1, 0.5, 3, -3],
    ])))).toEqual([0, 16384, 32767, -32768]);
  });

  it("rééchantillonne un extrait 24 kHz à 48 kHz sans ajouter son début ni sa fin", () => {
    const decoded = buffer([[1, 0, 0.5, -1]], 24_000);
    const result = audioBufferToNativePcm(decoded, 1 / 24_000, 3 / 24_000);
    expect(samples(result)).toEqual([0, 8192, 16384, -8192]);
  });

  it("borne une sélection au fichier et produit un PCM vide pour une sélection vide", () => {
    const decoded = buffer([[0.25, -0.25]]);
    expect(samples(audioBufferToNativePcm(decoded, -1, 3))).toEqual([8192, -8192]);
    expect(audioBufferToNativePcm(decoded, 1, 3)).toHaveLength(0);
  });
});
