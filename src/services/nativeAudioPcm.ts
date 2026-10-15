/** Convert a decoded slice into 48 kHz little-endian i16 mono or stereo PCM
 *  for native cue and soundboard rendering. Bounds are expressed in seconds. */
export function audioBufferToNativePcm(
  buffer: AudioBuffer,
  start = 0,
  end = buffer.duration,
  outputChannels: 1 | 2 = 1,
): Uint8Array {
  const from = Math.max(0, Math.min(start, buffer.duration));
  const to = Math.max(from, Math.min(end, buffer.duration));
  const firstSample = Math.min(buffer.length, from * buffer.sampleRate);
  const lastSample = Math.min(buffer.length, to * buffer.sampleRate);
  const outputFrames = (lastSample - firstSample) * 48_000 / buffer.sampleRate;
  const outputLength = Math.ceil(outputFrames - Number.EPSILON * Math.max(1, outputFrames) * 4);
  const bytes = new Uint8Array(outputLength * 2 * outputChannels);
  if (!buffer.length || !buffer.numberOfChannels) return bytes;
  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel),
  );
  for (let i = 0; i < outputLength; i++) {
    const position = firstSample + i * buffer.sampleRate / 48_000;
    const left = Math.min(Math.floor(position), buffer.length - 1);
    const right = Math.min(left + 1, buffer.length - 1);
    const fraction = position - left;
    for (let c = 0; c < outputChannels; c++) {
      let sample = 0;
      if (outputChannels === 1) {
        for (const channel of channels) sample += channel[left] + (channel[right] - channel[left]) * fraction;
        sample /= channels.length;
      } else {
        const channel = channels[Math.min(c, channels.length - 1)];
        sample = channel[left] + (channel[right] - channel[left]) * fraction;
      }
      sample = Math.max(-1, Math.min(1, sample));
      const pcm = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      const offset = (i * outputChannels + c) * 2;
      bytes[offset] = pcm & 0xff;
      bytes[offset + 1] = (pcm >> 8) & 0xff;
    }
  }
  return bytes;
}
