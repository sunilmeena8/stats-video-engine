import {
  RankedBarChart,
  interpolateRanking,
  type RankingEntry,
} from '@statsopedia/chart-components';
import {
  VIDEO_THEMES,
  paletteColor,
  yearPositionAtFrame,
  type VideoTheme,
} from '@statsopedia/video-config';
import type { ReactElement } from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  SAMPLE_ENTITIES,
  SAMPLE_SNAPSHOTS,
  SAMPLE_SOURCE_LABEL,
  SAMPLE_START_YEAR,
} from './sample-data';
import { buildSampleTimeline, type SampleCompositionProps } from './schema';

const FADE_FRAMES = 12;

function snapshotEntries(step: number, theme: VideoTheme): RankingEntry[] {
  const snapshot = SAMPLE_SNAPSHOTS[Math.min(step, SAMPLE_SNAPSHOTS.length - 1)];
  if (!snapshot) throw new Error(`Missing sample snapshot for step ${step}`);
  return SAMPLE_ENTITIES.map((entity) => ({
    id: entity.id,
    label: entity.label,
    value: snapshot.get(entity.id) ?? 0,
    color: paletteColor(theme, entity.index),
  }));
}

/** Fades a section in at its start and out at its end. */
function useSectionOpacity(durationInFrames: number): number {
  const frame = useCurrentFrame();
  return interpolate(
    frame,
    [0, FADE_FRAMES, durationInFrames - FADE_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

function TitleCard({
  title,
  subtitle,
  theme,
  durationInFrames,
}: {
  title: string;
  subtitle: string;
  theme: VideoTheme;
  durationInFrames: number;
}): ReactElement {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = Math.min(width, height);
  const entrance = spring({ frame, fps, config: { damping: 200 } });
  const opacity = useSectionOpacity(durationInFrames);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: unit * 0.08,
        textAlign: 'center',
        opacity,
      }}
    >
      <div style={{ transform: `translateY(${(1 - entrance) * unit * 0.04}px)` }}>
        <div
          style={{
            color: theme.textPrimary,
            fontSize: unit * 0.075,
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: unit * 0.025,
              color: theme.textSecondary,
              fontSize: unit * 0.035,
            }}
          >
            {subtitle}
          </div>
        ) : null}
        <div
          style={{
            margin: `${unit * 0.04}px auto 0`,
            width: unit * 0.12 * entrance,
            height: Math.max(2, unit * 0.004),
            backgroundColor: theme.accent,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

function RankingScene({
  props,
  theme,
  durationInFrames,
}: {
  props: SampleCompositionProps;
  theme: VideoTheme;
  durationInFrames: number;
}): ReactElement {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const timeline = buildSampleTimeline(props);
  const opacity = useSectionOpacity(durationInFrames);

  const { stepIndex, progress } = yearPositionAtFrame(timeline, frame);
  const bars = interpolateRanking(
    snapshotEntries(stepIndex, theme),
    snapshotEntries(stepIndex + 1, theme),
    progress,
    props.topN,
  );
  const displayedYear = SAMPLE_START_YEAR + stepIndex + (progress >= 0.5 ? 1 : 0);

  const unit = Math.min(width, height);
  const padding = unit * 0.06;
  const headerHeight = unit * 0.13;
  const footerHeight = unit * 0.16;
  const chartHeight = height - padding * 2 - headerHeight - footerHeight;

  return (
    <AbsoluteFill style={{ padding, opacity }}>
      <div style={{ height: headerHeight }}>
        <div style={{ color: theme.textPrimary, fontSize: unit * 0.05, fontWeight: 800 }}>
          {props.title}
        </div>
        {props.subtitle ? (
          <div
            style={{ color: theme.textSecondary, fontSize: unit * 0.026, marginTop: unit * 0.008 }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
      <RankedBarChart
        bars={bars}
        topN={props.topN}
        width={width - padding * 2}
        height={chartHeight}
        theme={theme}
      />
      <div
        style={{
          height: footerHeight,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ color: theme.textMuted, fontSize: unit * 0.02 }}>
          Source: {SAMPLE_SOURCE_LABEL}
        </div>
        <div
          style={{
            color: theme.textSecondary,
            fontSize: unit * 0.13,
            fontWeight: 800,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {displayedYear}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/**
 * Sample composition: intro card → animated ranking of synthetic data → outro card.
 * Exercises the shared packages end to end (video-config timing/themes, chart-components).
 */
export function SampleComposition(props: SampleCompositionProps): ReactElement {
  const theme = VIDEO_THEMES[props.theme];
  const timeline = buildSampleTimeline(props);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, fontFamily: theme.fontFamily }}>
      <Sequence durationInFrames={timeline.introFrames} name="Intro">
        <TitleCard
          title={props.title}
          subtitle={props.subtitle}
          theme={theme}
          durationInFrames={timeline.introFrames}
        />
      </Sequence>
      <Sequence
        from={timeline.chartStartFrame}
        durationInFrames={timeline.chartFrames}
        name="Ranking"
      >
        <RankingScene props={props} theme={theme} durationInFrames={timeline.chartFrames} />
      </Sequence>
      <Sequence
        from={timeline.outroStartFrame}
        durationInFrames={timeline.outroFrames}
        name="Outro"
      >
        <TitleCard
          title="Statsopedia"
          subtitle="Sample composition rendered successfully"
          theme={theme}
          durationInFrames={timeline.outroFrames}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
