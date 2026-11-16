/**
 * Writes a short, loopable ambient pad to public/audio/statsopedia-synthetic-pad.wav.
 * Generated from sine waves (no third-party material), so it has no licensing constraints.
 *
 * Seamless loop: every frequency completes a whole number of cycles in LOOP_SECONDS. Peak level
 * is -12 dBFS, leaving headroom so the mix can never clip.
 *
 *   pnpm --filter @statsopedia/renderer sample:music
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44_100;
const LOOP_SECONDS = 20;
const PEAK = 10 ** (-12 / 20); // -12 dBFS

// A soft A-minor add9 voicing; each frequency × 20 s is an integer number of cycles.
const VOICES = [
  { hz: 110, gain: 0.5, pan: 0 },
  { hz: 165, gain: 0.32, pan: -0.4 },
  { hz: 220, gain: 0.3, pan: 0.3 },
  { hz: 261.6, gain: 0.22, pan: -0.2 },
  { hz: 329.6, gain: 0.18, pan: 0.45 },
  { hz: 493.9, gain: 0.08, pan: -0.5 },
];
// Slow swells: 0.1 Hz and 0.25 Hz both complete whole cycles in 20 s.
const swell = (t: number) =>
  0.75 + 0.15 * Math.sin(2 * Math.PI * 0.1 * t) + 0.1 * Math.sin(2 * Math.PI * 0.25 * t);

const frames = SAMPLE_RATE * LOOP_SECONDS;
const left = new Float64Array(frames);
const right = new Float64Array(frames);
for (let i = 0; i < frames; i++) {
  const t = i / SAMPLE_RATE;
  let l = 0;
  let r = 0;
  for (const voice of VOICES) {
    const sample = voice.gain * Math.sin(2 * Math.PI * voice.hz * t);
    l += sample * (1 - voice.pan) * 0.5;
    r += sample * (1 + voice.pan) * 0.5;
  }
  left[i] = l * swell(t);
  right[i] = r * swell(t);
}

let max = 0;
for (let i = 0; i < frames; i++) max = Math.max(max, Math.abs(left[i]!), Math.abs(right[i]!));
const scale = PEAK / max;

const dataBytes = frames * 2 * 2;
const wav = Buffer.alloc(44 + dataBytes);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(2, 22); // stereo
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataBytes, 40);
for (let i = 0; i < frames; i++) {
  wav.writeInt16LE(Math.round(left[i]! * scale * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(right[i]! * scale * 32767), 46 + i * 4);
}

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/audio/statsopedia-synthetic-pad.wav',
);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, wav);
process.stdout.write(`Wrote ${out} (${LOOP_SECONDS}s, peak -12 dBFS)\n`);
