import { describe, expect, it } from 'vitest';

import { audioQualityChecks } from '../src/audio-checks.js';

const music = { fadeInSeconds: 2 };
const good = { integratedLufs: -19, truePeakDbtp: -3, startPeakDbtp: -58, endPeakDbtp: -55 };
const status = (measured: typeof good | Record<string, number | null>) =>
  Object.fromEntries(
    audioQualityChecks(music, { ...good, ...measured }).map((check) => [check.id, check.status]),
  );

describe('audioQualityChecks', () => {
  it('passes audible, unclipped, faded music', () => {
    expect(status({})).toEqual({
      music_audible: 'pass',
      music_clipping: 'pass',
      music_fades: 'pass',
    });
  });

  it('fails silent or inaudible music and clipped audio', () => {
    expect(status({ integratedLufs: null }).music_audible).toBe('fail');
    expect(status({ integratedLufs: -52 }).music_audible).toBe('fail');
    expect(status({ truePeakDbtp: 0.4 }).music_clipping).toBe('fail');
    expect(status({ truePeakDbtp: -0.2 }).music_clipping).toBe('warn');
  });

  it('fails music that stops instead of fading out, or ignores its fade-in', () => {
    expect(status({ endPeakDbtp: -12 }).music_fades).toBe('fail');
    expect(status({ startPeakDbtp: -12 }).music_fades).toBe('fail');
    // Without a configured fade-in an abrupt start is what was asked for.
    expect(
      audioQualityChecks({ fadeInSeconds: 0 }, { ...good, startPeakDbtp: -12 })[2]!.status,
    ).toBe('pass');
    expect(status({ endPeakDbtp: null }).music_fades).toBe('pass');
  });
});
