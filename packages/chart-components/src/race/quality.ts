import type {
  BarChartRaceProps,
  MediaAsset,
  QualityCheck,
  QualityReport,
  QualityStatus,
  RenderKind,
} from '@statsopedia/shared-types';
import {
  MUSIC_MIN_LUFS,
  MUSIC_QUIET_LUFS,
  VIDEO_THEMES,
  effectiveLoudness,
  planMusic,
  planRaceRender,
  type RaceTimeline,
} from '@statsopedia/video-config';

import { annotationOverflow, estimateLines, planAnnotations } from './annotations.js';
import { buildCredits, compactSourceLabel } from './credits.js';
import { computeRaceLayout } from './layout.js';
import { buildRaceData } from './model.js';

/** YouTube accepts Shorts up to three minutes. */
export const SHORTS_MAX_SECONDS = 180;
/** Smallest on-screen text, in output pixels. */
export const MIN_TEXT_PX = 12;

export type QualityMusicAsset = Pick<
  MediaAsset,
  'name' | 'audio' | 'durationSeconds' | 'commercialUse' | 'attributionRequired' | 'attribution'
>;

export interface QualityInput {
  props: BarChartRaceProps;
  kind: RenderKind;
  /** The volume the project asked for, before any lowering to avoid clipping. */
  requestedVolume: number | null;
  /** The project's music asset (null without music). */
  musicAsset: QualityMusicAsset | null;
}

const RANK: Record<QualityStatus, number> = { pass: 0, warn: 1, fail: 2 };

export function worstStatus(checks: readonly { status: QualityStatus }[]): QualityStatus {
  return checks.reduce<QualityStatus>(
    (worst, check) => (RANK[check.status] > RANK[worst] ? check.status : worst),
    'pass',
  );
}

const seconds = (value: number) => `${Math.round(value * 10) / 10} s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const list = (items: string[]) =>
  items.length <= 3
    ? items.join(', ')
    : `${items.slice(0, 3).join(', ')} and ${items.length - 3} more`;

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG contrast ratio of two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

function rangeLabel(ranks: number[]): string {
  if (ranks.length === 1) return `rank ${ranks[0]}`;
  return `ranks ${ranks[0]}–${ranks.at(-1)}`;
}

function musicChecks(input: QualityInput, timeline: RaceTimeline): QualityCheck[] {
  const music = input.props.config.music;
  if (!music) {
    return [
      {
        id: 'music_coverage',
        status: 'pass',
        title: 'Music covers the video',
        detail: 'No background music.',
      },
    ];
  }
  const asset = input.musicAsset;
  const duration = timeline.durationInFrames / timeline.fps;
  const checks: QualityCheck[] = [];

  const plan = planMusic(music, timeline);
  checks.push({
    id: 'music_coverage',
    title: 'Music covers the video',
    ...(plan.coverage === 'full'
      ? {
          status: 'pass',
          detail: `The ${seconds(music.durationSeconds!)} track is cut after the fade-out.`,
        }
      : plan.coverage === 'looped'
        ? {
            status: 'pass',
            detail: `The ${seconds(music.durationSeconds!)} track plays ${plan.plays} times with crossfades to cover ${seconds(duration)}.`,
          }
        : plan.coverage === 'too_short'
          ? {
              status: 'fail',
              detail: `The track is ${seconds(music.durationSeconds!)} but the video is ${seconds(duration)}. Turn on looping or choose a longer track.`,
            }
          : {
              status: 'warn',
              detail:
                'The track length was not measured (uploaded before analysis); it loops without crossfades.',
            }),
  });

  const loudness = effectiveLoudness(asset?.audio?.integratedLufs ?? null, music.volume);
  checks.push({
    id: 'music_audible',
    title: 'Music is audible',
    ...(music.volume <= 0
      ? { status: 'fail', detail: 'The volume is 0%.' }
      : !asset?.audio
        ? { status: 'warn', detail: 'The track has not been analysed, so its loudness is unknown.' }
        : loudness === null
          ? { status: 'fail', detail: 'The track is silent.' }
          : loudness < MUSIC_MIN_LUFS
            ? {
                status: 'fail',
                detail: `About ${Math.round(loudness)} LUFS at ${percent(music.volume)}: too quiet to hear.`,
              }
            : loudness < MUSIC_QUIET_LUFS
              ? {
                  status: 'warn',
                  detail: `About ${Math.round(loudness)} LUFS at ${percent(music.volume)}: quiet on phone speakers.`,
                }
              : {
                  status: 'pass',
                  detail: `About ${Math.round(loudness)} LUFS at ${percent(music.volume)}.`,
                }),
  });

  const peak = asset?.audio?.truePeakDbtp ?? null;
  const lowered = input.requestedVolume !== null && input.requestedVolume - music.volume > 0.0005;
  const peakAfter =
    peak === null || music.volume <= 0 ? null : peak + 20 * Math.log10(music.volume);
  checks.push({
    id: 'music_clipping',
    title: 'Music is not clipped',
    ...(!asset?.audio
      ? { status: 'warn', detail: 'The track has not been analysed, so its peak level is unknown.' }
      : lowered
        ? {
            status: 'pass',
            detail: `The track peaks at ${peak!.toFixed(1)} dBTP, so the volume was lowered from ${percent(input.requestedVolume!)} to ${percent(music.volume)} to stay below −1 dBTP.`,
          }
        : {
            status: 'pass',
            detail:
              peakAfter === null
                ? 'The track is silent.'
                : `Peaks at ${peakAfter.toFixed(1)} dBTP after the volume (limit −1 dBTP).`,
          }),
  });

  const fadeTotal = music.fadeInSeconds + music.fadeOutSeconds;
  checks.push({
    id: 'music_fades',
    title: 'Music fades in and out',
    ...(fadeTotal > duration
      ? {
          status: 'fail',
          detail: `Fades take ${seconds(fadeTotal)} but the video is ${seconds(duration)}.`,
        }
      : music.fadeOutSeconds < 0.5
        ? { status: 'warn', detail: 'A fade-out under 0.5 s makes the music stop abruptly.' }
        : music.fadeInSeconds < 0.2
          ? { status: 'warn', detail: 'Without a fade-in the music starts abruptly.' }
          : {
              status: 'pass',
              detail: `${seconds(music.fadeInSeconds)} in, ${seconds(music.fadeOutSeconds)} out${plan.coverage === 'looped' ? ', with crossfades between repeats' : ''}.`,
            }),
  });

  checks.push({
    id: 'music_license',
    title: 'Music license allows this use',
    ...(!asset
      ? { status: 'warn', detail: 'The music asset could not be checked.' }
      : asset.attributionRequired && !asset.attribution
        ? {
            status: 'fail',
            detail: 'The license requires attribution but no credit line is recorded.',
          }
        : asset.commercialUse === false
          ? {
              status: input.kind === 'final' ? 'fail' : 'warn',
              detail: `“${asset.name}” may not be used commercially; choose another track for published videos.`,
            }
          : asset.commercialUse === null
            ? { status: 'warn', detail: `Commercial use of “${asset.name}” is not recorded.` }
            : {
                status: 'pass',
                detail: asset.attributionRequired
                  ? 'Commercial use allowed; credited in the video.'
                  : 'Commercial use allowed; no attribution required.',
              }),
  });
  return checks;
}

/**
 * Checks a video before it is rendered: music, text, annotations, credits and scene timing.
 * `fail` means the video would be broken or non-compliant (renders are refused); `warn` is
 * shown to the editor. Pure: the Studio and the API run the same checks on the same props.
 */
export function checkRaceQuality(input: QualityInput): QualityReport {
  const { props } = input;
  const { config, dataset } = props;
  const plan = planRaceRender(props);
  const { timeline } = plan;
  const layout = computeRaceLayout({ width: plan.width, height: plan.height, topN: config.topN });
  const data = buildRaceData(dataset, config, () => '#000000');
  const annotations = planAnnotations({
    annotations: config.annotations,
    data,
    timeline,
    layout,
    topN: config.topN,
  });
  const theme = VIDEO_THEMES[config.theme];
  const duration = plan.durationInFrames / plan.fps;
  const checks: QualityCheck[] = [...musicChecks(input, timeline)];

  // ── Text
  const textProblems: string[] = [];
  const smallest = Math.min(layout.text.small, layout.text.axis, layout.footer.size);
  if (smallest < MIN_TEXT_PX) {
    textProblems.push(`the smallest text is ${smallest.toFixed(0)} px (minimum ${MIN_TEXT_PX} px)`);
  }
  const secondary = contrastRatio(theme.textSecondary, theme.background);
  const muted = contrastRatio(theme.textMuted, theme.background);
  if (secondary < 4.5) textProblems.push(`secondary text contrast is ${secondary.toFixed(1)}:1`);
  if (muted < 3) textProblems.push(`muted text contrast is ${muted.toFixed(1)}:1`);
  const titleWidth = layout.vertical
    ? layout.width - layout.padX * 2
    : (layout.width - layout.padX * 2) * 0.62;
  if (estimateLines(config.title, layout.header.titleSize, titleWidth, 9) > 2) {
    textProblems.push('the title wraps to more than two lines');
  }
  const truncated = annotations.placed
    .filter(({ annotation, slot }) => {
      const overflow = annotationOverflow(annotation, layout, slot);
      return overflow.title || overflow.text;
    })
    .map(({ annotation }) => `“${annotation.title}”`);
  if (truncated.length) textProblems.push(`text is cut short in ${list(truncated)}`);
  checks.push({
    id: 'text_readable',
    title: 'Text is readable',
    status: textProblems.length ? 'warn' : 'pass',
    detail: textProblems.length
      ? `${textProblems.join('; ')}.`
      : `Smallest text ${smallest.toFixed(0)} px; contrast ${secondary.toFixed(1)}:1 or better.`,
  });

  // ── Annotations
  const facts = config.annotations.filter((annotation) => annotation.kind !== 'caption');
  const unsourcedCaptions = config.annotations.filter(
    (annotation) =>
      annotation.kind === 'caption' &&
      annotation.sources.length === 0 &&
      /\d/.test(`${annotation.title} ${annotation.text ?? ''}`),
  );
  const citations = new Set(
    config.annotations.flatMap((annotation) => annotation.sources.map((source) => source.name)),
  );
  checks.push({
    id: 'annotation_sources',
    title: 'Annotation facts cite sources',
    ...(unsourcedCaptions.length
      ? {
          status: 'warn',
          detail: `Captions with figures but no source: ${list(unsourcedCaptions.map((a) => `“${a.title}”`))}. Cite a source or make them a fact kind.`,
        }
      : {
          status: 'pass',
          detail: config.annotations.length
            ? `${facts.length} fact${facts.length === 1 ? '' : 's'} cite ${citations.size} source${citations.size === 1 ? '' : 's'}.`
            : 'No annotations.',
        }),
  });

  const covering = annotations.placed.filter((placed) => placed.coveredRanks.length > 0);
  checks.push({
    id: 'annotation_overlap',
    title: 'Annotations keep the chart visible',
    status: covering.length ? 'warn' : 'pass',
    detail: covering.length
      ? covering
          .map(
            (placed) =>
              `“${placed.annotation.title}” covers ${rangeLabel(placed.coveredRanks)}${placed.annotation.position === 'auto' ? '' : ' (try Auto position)'}`,
          )
          .join('; ') + '.'
      : layout.vertical
        ? 'In portrait, annotations use the title band above the chart.'
        : 'No annotation covers ranked bars.',
  });

  const noRoom = annotations.skipped.filter((item) => item.reason === 'no_room');
  const deferred = annotations.placed.filter((placed) => placed.deferredFrames > 0);
  checks.push({
    id: 'annotation_collisions',
    title: 'Annotations do not overlap each other',
    ...(noRoom.length
      ? {
          status: 'fail',
          detail: `No room before the race ends for ${list(noRoom.map(({ annotation }) => `“${annotation.title}”`))}: shorten or move the notes around it, or lower another note's priority.`,
        }
      : deferred.length
        ? {
            status: 'warn',
            detail:
              deferred
                .map(
                  (placed) =>
                    `“${placed.annotation.title}” waits ${seconds(placed.deferredFrames / plan.fps)} for a higher-priority note`,
                )
                .join('; ') + '.',
          }
        : { status: 'pass', detail: 'Every annotation has its own place and time.' }),
  });

  // ── Credits
  const credits = buildCredits(dataset, config);
  const label = compactSourceLabel(dataset, config);
  const creditProblems: { status: QualityStatus; text: string }[] = [];
  if (!label) {
    creditProblems.push({
      status: 'fail',
      text: 'no source is shown: the dataset cites none and no source label is set',
    });
  }
  if (credits.music && timeline.creditsFrames === 0 && timeline.outroFrames === 0) {
    creditProblems.push({
      status: 'fail',
      text: 'the music license requires attribution: enable the outro or the credits scene',
    });
  }
  if (timeline.creditsFrames === 0) {
    creditProblems.push({
      status: 'warn',
      text: credits.editorial.length
        ? 'no credits scene: annotation sources appear only on their cards'
        : 'no credits scene: sources appear only in the compact label',
    });
  } else if (timeline.creditsFrames < 2 * plan.fps) {
    creditProblems.push({ status: 'warn', text: 'the credits scene is too short to read' });
  }
  checks.push({
    id: 'source_credits',
    title: 'Source credits are visible',
    status: worstStatus(creditProblems),
    detail: creditProblems.length
      ? `${creditProblems.map((problem) => problem.text).join('; ')}.`
      : `“${label}” under the chart, and ${credits.data.length + credits.editorial.length} source${credits.data.length + credits.editorial.length === 1 ? '' : 's'} in a ${seconds(timeline.creditsFrames / plan.fps)} credits scene.`,
  });

  // ── Scene timing
  const timingProblems: { status: QualityStatus; text: string }[] = [];
  if (config.outputFormat === 'short' && duration > SHORTS_MAX_SECONDS) {
    timingProblems.push({
      status: 'fail',
      text: `the Short is ${seconds(duration)}; YouTube Shorts can be at most ${SHORTS_MAX_SECONDS} s (speed it up or shorten the period range)`,
    });
  }
  const outside = annotations.skipped.filter((item) => item.reason === 'outside');
  if (outside.length) {
    timingProblems.push({
      status: 'warn',
      text: `${list(outside.map(({ annotation }) => `“${annotation.title}”`))} ${outside.length === 1 ? 'falls' : 'fall'} outside the race and will not be shown`,
    });
  }
  const clipped = annotations.placed.filter((placed) => placed.clipped);
  if (clipped.length) {
    timingProblems.push({
      status: 'warn',
      text: `${list(clipped.map(({ annotation }) => `“${annotation.title}”`))} ${clipped.length === 1 ? 'is' : 'are'} shortened to end before the final ranking`,
    });
  }
  checks.push({
    id: 'scene_timing',
    title: 'Scenes fit the video',
    status: worstStatus(timingProblems),
    detail: timingProblems.length
      ? `${timingProblems.map((problem) => problem.text).join('; ')}.`
      : `${seconds(duration)}: intro ${seconds(timeline.introFrames / plan.fps)}, race ${seconds(timeline.chartFrames / plan.fps)}, outro ${seconds(timeline.outroFrames / plan.fps)}, credits ${seconds(timeline.creditsFrames / plan.fps)}.`,
  });

  return { status: worstStatus(checks), checks };
}
