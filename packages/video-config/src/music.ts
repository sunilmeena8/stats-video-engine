import type { MediaAsset, RaceMusic } from '@statsopedia/shared-types';

/** Highest level the music may reach after gain (EBU R128 / YouTube delivery headroom). */
export const MUSIC_TRUE_PEAK_CEILING_DBTP = -1;
/** Music quieter than this (integrated, in the video) is inaudible on phone speakers. */
export const MUSIC_MIN_LUFS = -45;
/** Music quieter than this is hard to hear. */
export const MUSIC_QUIET_LUFS = -32;
/** The first and last moments of a faded track must be at least this quiet. */
export const FADE_EDGE_MAX_DBTP = -30;
/** Overlap between two repeats of a looped track. */
export const LOOP_CROSSFADE_SECONDS = 1.5;

/** Music as `buildRaceConfig` needs it: where the file is and what was measured. */
export interface ResolvedMusic {
  /** Source for the composition (`storage:assets/…` or an http(s) URL). */
  src: string;
  durationSeconds: number | null;
  truePeakDbtp: number | null;
  /** Credit line, only when the license requires one. */
  attribution: string | null;
}

/** The composition-facing view of a music asset. Used by the API and the Studio alike. */
export function resolveMusicAsset(
  asset: Pick<MediaAsset, 'durationSeconds' | 'audio' | 'attributionRequired' | 'attribution'>,
  src: string,
): ResolvedMusic {
  return {
    src,
    durationSeconds: asset.durationSeconds,
    truePeakDbtp: asset.audio?.truePeakDbtp ?? null,
    attribution: asset.attributionRequired ? asset.attribution : null,
  };
}

/**
 * Highest gain (0–1) that keeps a track with this true peak under the ceiling. Gain is never
 * above 1, so music is never amplified; a track mastered hotter than the ceiling is turned down.
 */
export function safeMusicGain(truePeakDbtp: number | null): number {
  if (truePeakDbtp === null) return 1;
  const gain = 10 ** ((MUSIC_TRUE_PEAK_CEILING_DBTP - truePeakDbtp) / 20);
  return Math.min(1, Math.floor(gain * 1000) / 1000);
}

/** Loudness of the music in the video, from the track's loudness and the gain. */
export function effectiveLoudness(integratedLufs: number | null, volume: number): number | null {
  if (integratedLufs === null || volume <= 0) return null;
  return integratedLufs + 20 * Math.log10(volume);
}

/** One play of the track. Repeats overlap by a crossfade so loops have no audible seam. */
export interface MusicSegment {
  /** Composition frame the play starts at. */
  from: number;
  durationInFrames: number;
  /** Crossfade from the previous repeat (0 for the first play). */
  crossfadeInFrames: number;
  /** Crossfade into the next repeat (0 for the last play). */
  crossfadeOutFrames: number;
}

export type MusicCoverage =
  /** The track is at least as long as the video; it is cut at the end (after the fade-out). */
  | 'full'
  /** A short track is repeated with crossfades. */
  | 'looped'
  /** A short track without looping: silence after it ends. Refused by the quality checks. */
  | 'too_short'
  /** Length unknown (older uploads): the track is looped without crossfades. */
  | 'unknown';

export interface MusicPlan {
  coverage: MusicCoverage;
  trackFrames: number | null;
  /** Number of plays (1 when not looped). */
  plays: number;
  segments: MusicSegment[];
}

/** How the track is laid out across the video. Pure, so the Player and renders agree. */
export function planMusic(
  music: Pick<RaceMusic, 'durationSeconds' | 'loop'>,
  { fps, durationInFrames }: { fps: number; durationInFrames: number },
): MusicPlan {
  const whole = (frames: number): MusicSegment[] => [
    { from: 0, durationInFrames: frames, crossfadeInFrames: 0, crossfadeOutFrames: 0 },
  ];
  if (music.durationSeconds === null) {
    return { coverage: 'unknown', trackFrames: null, plays: 1, segments: whole(durationInFrames) };
  }
  const trackFrames = Math.max(1, Math.floor(music.durationSeconds * fps));
  if (trackFrames >= durationInFrames) {
    return { coverage: 'full', trackFrames, plays: 1, segments: whole(durationInFrames) };
  }
  if (!music.loop) {
    return { coverage: 'too_short', trackFrames, plays: 1, segments: whole(trackFrames) };
  }
  // The crossfade never takes more than a quarter of the track.
  const crossfade = Math.min(Math.round(LOOP_CROSSFADE_SECONDS * fps), Math.floor(trackFrames / 4));
  const step = trackFrames - crossfade;
  const segments: MusicSegment[] = [];
  for (let from = 0; from < durationInFrames; from += step) {
    const last = from + trackFrames >= durationInFrames;
    segments.push({
      from,
      durationInFrames: Math.min(trackFrames, durationInFrames - from),
      crossfadeInFrames: from === 0 ? 0 : crossfade,
      crossfadeOutFrames: last ? 0 : crossfade,
    });
    if (last) break;
  }
  return { coverage: 'looped', trackFrames, plays: segments.length, segments };
}

/**
 * Gain of one play at `localFrame` (frames since the play started) from its crossfades.
 * Crossfades are linear, so two overlapping plays always sum to 1 and cannot clip.
 */
export function crossfadeGain(segment: MusicSegment, localFrame: number): number {
  let gain = 1;
  if (segment.crossfadeInFrames > 0) {
    gain = Math.min(gain, localFrame / segment.crossfadeInFrames);
  }
  if (segment.crossfadeOutFrames > 0) {
    const start = segment.durationInFrames - segment.crossfadeOutFrames;
    gain = Math.min(gain, 1 - (localFrame - start) / segment.crossfadeOutFrames);
  }
  return Math.max(0, Math.min(1, gain));
}
