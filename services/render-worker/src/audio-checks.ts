import type { QualityCheck, RaceMusic } from '@statsopedia/shared-types';
import { FADE_EDGE_MAX_DBTP, MUSIC_MIN_LUFS } from '@statsopedia/video-config';

/** Length of the windows measured at the start and end of the video. */
export const EDGE_SECONDS = 0.05;
/** Above this the encoded audio clips. */
export const CLIP_DBTP = 0;
/** Above this the encoder overshot the −1 dBTP the music was mixed to. */
export const HOT_DBTP = -0.5;

export interface AudioMeasurements {
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  startPeakDbtp: number | null;
  endPeakDbtp: number | null;
}

const db = (value: number | null) => (value === null ? 'silence' : `${value.toFixed(1)} dBTP`);

/**
 * Checks of the encoded audio of a video with music, measured from the file the worker is
 * about to publish: the music is there and audible, does not clip, and fades in and out.
 */
export function audioQualityChecks(
  music: Pick<RaceMusic, 'fadeInSeconds'>,
  measured: AudioMeasurements,
): QualityCheck[] {
  const { integratedLufs, truePeakDbtp, startPeakDbtp, endPeakDbtp } = measured;
  const startFaded = startPeakDbtp === null || startPeakDbtp <= FADE_EDGE_MAX_DBTP;
  const endFaded = endPeakDbtp === null || endPeakDbtp <= FADE_EDGE_MAX_DBTP;
  return [
    {
      id: 'music_audible',
      title: 'Music is audible',
      ...(integratedLufs === null || integratedLufs < MUSIC_MIN_LUFS
        ? {
            status: 'fail' as const,
            detail: `The encoded music measures ${integratedLufs === null ? 'silent' : `${integratedLufs.toFixed(1)} LUFS`}.`,
          }
        : { status: 'pass' as const, detail: `Measured ${integratedLufs.toFixed(1)} LUFS.` }),
    },
    {
      id: 'music_clipping',
      title: 'Music is not clipped',
      ...(truePeakDbtp !== null && truePeakDbtp > CLIP_DBTP
        ? { status: 'fail' as const, detail: `The encoded audio peaks at ${db(truePeakDbtp)}.` }
        : truePeakDbtp !== null && truePeakDbtp > HOT_DBTP
          ? {
              status: 'warn' as const,
              detail: `Peaks at ${db(truePeakDbtp)}, close to full scale.`,
            }
          : { status: 'pass' as const, detail: `Peaks at ${db(truePeakDbtp)}.` }),
    },
    {
      id: 'music_fades',
      title: 'Music fades in and out',
      ...(!endFaded
        ? {
            status: 'fail' as const,
            detail: `The last ${EDGE_SECONDS * 1000} ms are at ${db(endPeakDbtp)}: the music stops instead of fading out.`,
          }
        : !startFaded && music.fadeInSeconds >= 0.2
          ? {
              status: 'fail' as const,
              detail: `The first ${EDGE_SECONDS * 1000} ms are at ${db(startPeakDbtp)} despite a fade-in.`,
            }
          : {
              status: 'pass' as const,
              detail: `Starts at ${db(startPeakDbtp)}, ends at ${db(endPeakDbtp)}.`,
            }),
    },
  ];
}
