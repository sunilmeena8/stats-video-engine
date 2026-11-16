/**
 * Quality checks of a video. The same checks run in the Studio (live), in the API before a
 * render is queued (a `fail` refuses the render), and in the render worker on the encoded file.
 */
export const QUALITY_CHECK_IDS = [
  'music_coverage',
  'music_audible',
  'music_clipping',
  'music_fades',
  'music_license',
  'text_readable',
  'annotation_sources',
  'annotation_overlap',
  'annotation_collisions',
  'source_credits',
  'scene_timing',
] as const;
export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number];

export const QUALITY_STATUSES = ['pass', 'warn', 'fail'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export interface QualityCheck {
  id: QualityCheckId;
  status: QualityStatus;
  /** What was checked, e.g. "Music is not clipped". */
  title: string;
  /** What was found, with numbers. */
  detail: string;
}

export interface QualityReport {
  /** The worst status of any check. */
  status: QualityStatus;
  checks: QualityCheck[];
}
