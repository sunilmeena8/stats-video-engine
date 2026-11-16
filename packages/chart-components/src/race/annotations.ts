import type {
  AnnotationKind,
  AnnotationPriority,
  EditorialAnnotation,
} from '@statsopedia/shared-types';
import { raceStateAtFrame, type RaceTimeline } from '@statsopedia/video-config';

import type { RaceLayout } from './layout.js';
import { barFraction, computeRaceFrame, resolveAnnotationTiming, type RaceData } from './model.js';

/** Small label above an annotation's title; captions have none. */
export const ANNOTATION_KIND_LABEL: Record<AnnotationKind, string | null> = {
  milestone: 'Milestone',
  ranking_change: 'Ranking change',
  winner: 'Winner',
  top_entry: 'New entry',
  value_change: 'Big change',
  caption: null,
};

const PRIORITY_RANK: Record<AnnotationPriority, number> = { high: 0, normal: 1, low: 2 };

/** Line limits: longer text is truncated with an ellipsis (and reported by the checks). */
export const ANNOTATION_MAX_LINES = { title: 2, text: 3, sources: 1 } as const;
/** Average glyph width of Inter as a share of the font size (deliberately generous). */
const GLYPH_WIDTH = 0.56;

export type AnnotationSlot =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'banner' | 'header';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Type sizes and spacing of an annotation card at this layout. */
export function annotationTypography(layout: RaceLayout) {
  const u = layout.unit;
  return {
    padX: u * 24,
    padY: u * 20,
    gap: u * 6,
    imageSize: u * 72,
    imageGap: u * 18,
    label: layout.text.small,
    title: layout.text.name * 1.05,
    text: layout.text.small * 1.05,
    source: layout.text.small * 0.85,
  };
}

/** Lines `text` needs at `fontSize` in `width` px, at most `max`. */
export function estimateLines(text: string, fontSize: number, width: number, max: number): number {
  if (!text) return 0;
  const perLine = Math.max(1, Math.floor(width / (fontSize * GLYPH_WIDTH)));
  return Math.min(max, Math.ceil([...text].length / perLine));
}

/** Whether the title or text is longer than the card can show. */
export function annotationOverflow(
  annotation: EditorialAnnotation,
  layout: RaceLayout,
  slot: AnnotationSlot,
): { title: boolean; text: boolean } {
  const type = annotationTypography(layout);
  const width = contentWidth(annotation, layout, slot);
  const lines = (text: string, size: number) =>
    estimateLines(text, size, width, Number.POSITIVE_INFINITY);
  return {
    title: lines(annotation.title, type.title) > ANNOTATION_MAX_LINES.title,
    text: lines(annotation.text ?? '', type.text) > ANNOTATION_MAX_LINES.text,
  };
}

function cardWidth(layout: RaceLayout, slot: AnnotationSlot): number {
  if (slot === 'header') return layout.width - layout.padX * 2;
  if (slot === 'banner') return layout.chart.width;
  return layout.annotation.width;
}

function contentWidth(annotation: EditorialAnnotation, layout: RaceLayout, slot: AnnotationSlot) {
  const type = annotationTypography(layout);
  const image = annotation.imageUrl ? type.imageSize + type.imageGap : 0;
  return cardWidth(layout, slot) - type.padX * 2 - image;
}

/** Height of the card when every line it may use is filled (line clamps cap the real one). */
export function annotationHeight(
  annotation: EditorialAnnotation,
  layout: RaceLayout,
  slot: AnnotationSlot,
): number {
  const type = annotationTypography(layout);
  const width = contentWidth(annotation, layout, slot);
  const titleLines = Math.max(
    1,
    estimateLines(annotation.title, type.title, width, ANNOTATION_MAX_LINES.title),
  );
  const textLines = estimateLines(
    annotation.text ?? '',
    type.text,
    width,
    ANNOTATION_MAX_LINES.text,
  );
  let height = type.padY * 2 + type.label * 1.4 + type.gap + titleLines * type.title * 1.2;
  if (textLines) height += type.gap + textLines * type.text * 1.4;
  if (annotation.sources.length) height += type.gap + type.source * 1.4;
  if (annotation.imageUrl) height = Math.max(height, type.imageSize + type.padY * 2);
  return Math.ceil(height);
}

/** Where a card sits for a slot. Bottom slots grow upwards from the bottom of the chart. */
export function slotRect(layout: RaceLayout, slot: AnnotationSlot, height: number): Rect {
  const { chart, annotation: box, padX, columns, width: frameWidth } = layout;
  const width = cardWidth(layout, slot);
  const chartBottom = chart.top + chart.height;
  switch (slot) {
    case 'header': {
      // Portrait: the band above the year counter. It covers the title briefly, never the bars.
      const minHeight = layout.year.top - box.verticalTop - layout.unit * 40;
      return { left: padX, top: box.verticalTop, width, height: Math.max(height, minHeight) };
    }
    case 'banner':
      return { left: chart.left, top: chartBottom - box.inset - height, width, height };
    case 'top-left':
    case 'top-right':
    case 'bottom-left':
    case 'bottom-right': {
      const [vertical, horizontal] = slot.split('-') as ['top' | 'bottom', 'left' | 'right'];
      const left =
        horizontal === 'right' ? frameWidth - padX - box.inset * 0.25 - width : columns.trackLeft;
      const top = vertical === 'top' ? chart.rowsTop + box.inset : chartBottom - box.inset - height;
      return { left, top, width, height };
    }
  }
}

const intersects = (a: Rect, b: Rect) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/** Areas holding ranks, names, bars and values at `frame`: what an annotation must not cover. */
export function chartContentRects(
  data: RaceData,
  timeline: RaceTimeline,
  layout: RaceLayout,
  topN: number,
  frame: number,
): { rank: number; rect: Rect }[] {
  const state = raceStateAtFrame(timeline, frame);
  const race = computeRaceFrame(
    data.keyframes[state.periodIndex]!,
    data.keyframes[state.nextIndex]!,
    state.progress,
    topN,
    data.order,
  );
  const { chart, columns, text } = layout;
  // Value labels are about seven glyphs wide ("1,234.5B").
  const valueWidth = Math.min(columns.valueReserve, text.value * GLYPH_WIDTH * 7);
  return race.bars
    .filter((bar) => bar.opacity > 0.3)
    .map((bar) => {
      const barEnd = columns.trackLeft + barFraction(bar.value, race.scaleMax) * columns.trackWidth;
      const top =
        chart.rowsTop + bar.slot * chart.rowHeight + (chart.rowHeight - chart.barThickness) / 2;
      return {
        rank: bar.rank,
        rect: {
          left: chart.left,
          top,
          width: barEnd + valueWidth - chart.left,
          height: chart.barThickness,
        },
      };
    });
}

export interface PlacedAnnotation {
  annotation: EditorialAnnotation;
  slot: AnnotationSlot;
  rect: Rect;
  from: number;
  durationInFrames: number;
  /** Frames it was moved later because a higher-priority note held its place. */
  deferredFrames: number;
  /** Shortened to fit inside the chart section. */
  clipped: boolean;
  /** Ranks whose rows it covers at some point (empty = covers no chart content). */
  coveredRanks: number[];
}

export interface SkippedAnnotation {
  annotation: EditorialAnnotation;
  /** `outside`: its time is not in the chart section. `no_room`: no free place before the end. */
  reason: 'outside' | 'no_room';
}

export interface AnnotationPlan {
  /** In drawing order: lower priority first, so higher priority is on top. */
  placed: PlacedAnnotation[];
  skipped: SkippedAnnotation[];
}

const CORNERS: AnnotationSlot[] = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];

function candidateSlots(annotation: EditorialAnnotation, layout: RaceLayout): AnnotationSlot[] {
  if (layout.vertical) return ['header'];
  if (annotation.style === 'banner') return ['banner'];
  return annotation.position === 'auto' ? CORNERS : [annotation.position];
}

/**
 * Decides when and where every annotation is shown:
 *
 * - Higher priority first. Two notes never overlap: a note whose place is taken waits until it
 *   is free (keeping its length, within the chart section) or is skipped when no place frees up.
 * - `auto` takes the corner that covers the fewest ranked rows while it is shown, so notes sit
 *   in the empty space beside short bars instead of on top of the leaders.
 *
 * Pure and deterministic: the Player, renders and the quality checks share the result.
 */
export function planAnnotations({
  annotations,
  data,
  timeline,
  layout,
  topN,
}: {
  annotations: readonly EditorialAnnotation[];
  data: RaceData;
  timeline: RaceTimeline;
  layout: RaceLayout;
  topN: number;
}): AnnotationPlan {
  const minFrames = Math.max(1, Math.round(timeline.fps));
  const order = annotations
    .map((annotation, index) => ({ annotation, index }))
    .map((item) => ({
      ...item,
      timing: resolveAnnotationTiming(item.annotation, data.periods, timeline),
    }))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.annotation.priority] - PRIORITY_RANK[b.annotation.priority] ||
        a.timing.from - b.timing.from ||
        a.index - b.index,
    );

  const placed: (PlacedAnnotation & { index: number })[] = [];
  const skipped: SkippedAnnotation[] = [];
  const contentCache = new Map<number, { rank: number; rect: Rect }[]>();
  const contentAt = (frame: number) => {
    let rects = contentCache.get(frame);
    if (!rects) {
      rects = chartContentRects(data, timeline, layout, topN, frame);
      contentCache.set(frame, rects);
    }
    return rects;
  };
  const covered = (rect: Rect, from: number, end: number): number[] => {
    if (layout.vertical) return [];
    const step = Math.max(1, Math.round(timeline.fps / 4));
    const ranks = new Set<number>();
    for (let frame = from; frame < end; frame += step) {
      for (const item of contentAt(frame)) if (intersects(rect, item.rect)) ranks.add(item.rank);
    }
    return [...ranks].sort((a, b) => a - b);
  };

  for (const { annotation, index, timing } of order) {
    if (timing.status === 'outside') {
      skipped.push({ annotation, reason: 'outside' });
      continue;
    }
    const length = timing.end - timing.from;
    const slots = candidateSlots(annotation, layout).map((slot) => ({
      slot,
      rect: slotRect(layout, slot, annotationHeight(annotation, layout, slot)),
    }));
    let from = timing.from;
    let result: PlacedAnnotation | null = null;
    while (from + Math.min(minFrames, length) <= timeline.outroStartFrame) {
      const end = Math.min(from + length, timeline.outroStartFrame);
      const blockers = (rect: Rect) =>
        placed.filter(
          (other) =>
            other.from < end &&
            from < other.from + other.durationInFrames &&
            intersects(rect, other.rect),
        );
      const free = slots.filter(({ rect }) => blockers(rect).length === 0);
      if (free.length) {
        const scored = free.map((candidate) => ({
          ...candidate,
          ranks: covered(candidate.rect, from, end),
        }));
        const best = scored.reduce((a, b) => (b.ranks.length < a.ranks.length ? b : a));
        result = {
          annotation,
          slot: best.slot,
          rect: best.rect,
          from,
          durationInFrames: end - from,
          deferredFrames: from - timing.from,
          clipped: timing.status === 'clipped' || end - from < length,
          coveredRanks: best.ranks,
        };
        break;
      }
      // Wait for the earliest moment one of the places frees up.
      from = Math.min(
        ...slots.map(({ rect }) =>
          Math.max(...blockers(rect).map((other) => other.from + other.durationInFrames)),
        ),
      );
    }
    if (result) placed.push({ ...result, index });
    else skipped.push({ annotation, reason: 'no_room' });
  }

  return {
    placed: placed
      .sort(
        (a, b) =>
          PRIORITY_RANK[b.annotation.priority] - PRIORITY_RANK[a.annotation.priority] ||
          a.from - b.from ||
          a.index - b.index,
      )
      .map(({ index: _index, ...rest }) => rest),
    skipped,
  };
}
