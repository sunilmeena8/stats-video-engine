import { describe, expect, it } from 'vitest';

import { crossfadeGain, planMusic, resolveMusicAsset } from '../src/index.js';

const video = { fps: 30, durationInFrames: 30 * 60 };

describe('planMusic', () => {
  it('cuts a long track at the end of the video', () => {
    expect(planMusic({ durationSeconds: 90, loop: true }, video)).toMatchObject({
      coverage: 'full',
      plays: 1,
      segments: [{ from: 0, durationInFrames: 1800, crossfadeInFrames: 0, crossfadeOutFrames: 0 }],
    });
  });

  it('repeats a short track with crossfades until the video ends', () => {
    const plan = planMusic({ durationSeconds: 25, loop: true }, video);
    expect(plan.coverage).toBe('looped');
    // 750-frame track, 45-frame crossfade: plays start every 705 frames.
    expect(plan.segments.map((s) => [s.from, s.durationInFrames])).toEqual([
      [0, 750],
      [705, 750],
      [1410, 390],
    ]);
    expect(plan.segments[0]).toMatchObject({ crossfadeInFrames: 0, crossfadeOutFrames: 45 });
    expect(plan.segments[2]).toMatchObject({ crossfadeInFrames: 45, crossfadeOutFrames: 0 });
    const last = plan.segments.at(-1)!;
    expect(last.from + last.durationInFrames).toBe(video.durationInFrames);
  });

  it('keeps overlapping repeats at unity gain, so loops cannot clip', () => {
    const [first, second] = planMusic({ durationSeconds: 25, loop: true }, video).segments;
    for (let frame = second!.from; frame < first!.from + first!.durationInFrames; frame++) {
      const sum =
        crossfadeGain(first!, frame - first!.from) + crossfadeGain(second!, frame - second!.from);
      expect(sum).toBeCloseTo(1, 10);
    }
    expect(crossfadeGain(first!, 0)).toBe(1);
  });

  it('reports a short track that is not looped, and unknown lengths', () => {
    expect(planMusic({ durationSeconds: 25, loop: false }, video)).toMatchObject({
      coverage: 'too_short',
      segments: [{ from: 0, durationInFrames: 750 }],
    });
    expect(planMusic({ durationSeconds: null, loop: true }, video).coverage).toBe('unknown');
  });
});

describe('resolveMusicAsset', () => {
  it('passes the credit line only when the license requires it', () => {
    const asset = {
      durationSeconds: 30,
      audio: {
        codec: 'mp3',
        sampleRate: 44_100,
        channels: 2,
        truePeakDbtp: -0.3,
        integratedLufs: -14,
      },
      attributionRequired: false,
      attribution: 'Someone',
    };
    expect(resolveMusicAsset(asset, 'storage:assets/music/a.mp3')).toEqual({
      src: 'storage:assets/music/a.mp3',
      durationSeconds: 30,
      truePeakDbtp: -0.3,
      attribution: null,
    });
    expect(resolveMusicAsset({ ...asset, attributionRequired: true }, 'x').attribution).toBe(
      'Someone',
    );
  });
});
