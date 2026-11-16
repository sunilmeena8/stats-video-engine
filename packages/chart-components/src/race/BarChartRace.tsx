import type { BarChartRaceProps } from '@statsopedia/shared-types';
import {
  VIDEO_THEMES,
  computeRaceTimeline,
  paletteColor,
  raceStateAtFrame,
} from '@statsopedia/video-config';
import { useMemo, type ReactElement } from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { planAnnotations } from './annotations.js';
import { buildCredits, compactSourceLabel } from './credits.js';
import { computeRaceLayout } from './layout.js';
import { buildRaceData, computeRaceFrame, finalStandings, formatPeriodLabel } from './model.js';
import { BackgroundMusic, EditorialAnnotation, IntroCard } from './overlays.js';
import {
  Background,
  MetricLabel,
  SourceCredits,
  StatsopediaBranding,
  VideoHeader,
} from './parts.js';
import { RankingContainer } from './ranking-container.js';
import { CreditsScene, OutroScene } from './scenes.js';
import { TimelineProgress, YearIndicator } from './year-indicator.js';

/**
 * Animated horizontal bar chart race of a normalized dataset.
 *
 * Every frame is a pure function of the frame number and props: data preparation is memoized
 * per props, and positions, values and labels are computed from the timeline, so any frame can
 * be rendered on its own, in any order, with identical output.
 */
export function BarChartRace({ dataset, config }: BarChartRaceProps): ReactElement {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const theme = VIDEO_THEMES[config.theme];

  const data = useMemo(
    () =>
      buildRaceData(
        dataset,
        { startPeriod: config.startPeriod, endPeriod: config.endPeriod },
        (index) => paletteColor(theme, index),
      ),
    [dataset, config.startPeriod, config.endPeriod, theme],
  );
  const timeline = useMemo(
    () => computeRaceTimeline(config.timing, { fps, periodCount: data.periods.length }),
    [config.timing, fps, data.periods.length],
  );
  const layout = useMemo(
    () => computeRaceLayout({ width, height, topN: config.topN }),
    [width, height, config.topN],
  );
  const annotationPlan = useMemo(
    () =>
      planAnnotations({
        annotations: config.annotations,
        data,
        timeline,
        layout,
        topN: config.topN,
      }),
    [config.annotations, data, timeline, layout, config.topN],
  );
  const credits = useMemo(() => buildCredits(dataset, config), [dataset, config]);

  const state = raceStateAtFrame(timeline, frame);
  const from = data.keyframes[state.periodIndex]!;
  const to = data.keyframes[state.nextIndex]!;
  const race = computeRaceFrame(from, to, state.progress, config.topN, data.order);

  const label = (period: string) => formatPeriodLabel(period, data.frequency);
  const standings = useMemo(
    () =>
      finalStandings(data, Math.min(5, config.topN)).map(({ entity, ...standing }) => ({
        ...standing,
        name: entity.name,
        imageUrl: config.showLogos ? entity.imageUrl : null,
        color: entity.color,
      })),
    [data, config.topN, config.showLogos],
  );
  const metric = config.metricLabel ?? dataset.dataset.title;
  const unit = config.unitLabel ?? dataset.metric.unit;
  const sourceText = compactSourceLabel(dataset, config);
  const estimateNote = config.markEstimates
    ? 'Animated between data points; “est.” marks values estimated across short data gaps.'
    : 'Values are animated between data points.';

  // Chart fades in at the end of the intro and dims under the outro card.
  const introFade = timeline.introFrames
    ? interpolate(frame, [timeline.introFrames - fps * 0.6, timeline.introFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const outroDim = interpolate(
    frame,
    [timeline.outroStartFrame, timeline.outroStartFrame + fps * 0.5],
    [1, 0.14],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const firstLabel = label(data.periods[0]!);
  const lastLabel = label(data.periods.at(-1)!);

  return (
    <AbsoluteFill style={{ fontFamily: theme.fontFamily, color: theme.textPrimary }}>
      <Background theme={theme} />

      <AbsoluteFill style={{ opacity: introFade * outroDim }}>
        <VideoHeader
          title={config.title}
          subtitle={config.subtitle}
          theme={theme}
          layout={layout}
        />
        <YearIndicator
          fromLabel={label(from.period)}
          toLabel={label(to.period)}
          linearProgress={state.linearProgress}
          theme={theme}
          layout={layout}
        />
        <MetricLabel metric={metric} unit={unit} theme={theme} layout={layout} />
        <RankingContainer
          frame={race}
          entities={data.entities}
          layout={layout}
          theme={theme}
          format={config.valueFormat}
          showLogos={config.showLogos}
          markEstimates={config.markEstimates}
          emptyLabel={`No data for ${label(from.period)}`}
        />
        <TimelineProgress
          position={state.position}
          periodCount={data.periods.length}
          startLabel={firstLabel}
          endLabel={lastLabel}
          theme={theme}
          layout={layout}
        />
        <SourceCredits text={sourceText} note={estimateNote} theme={theme} layout={layout} />
        <div
          style={
            layout.brandTop === null
              ? { position: 'absolute', right: layout.padX, bottom: layout.footer.bottom }
              : { position: 'absolute', left: layout.padX, top: layout.brandTop }
          }
        >
          <StatsopediaBranding
            theme={theme}
            size={layout.footer.size}
            withTagline={!layout.vertical}
          />
        </div>
      </AbsoluteFill>

      {annotationPlan.placed.map((placed) => (
        <Sequence
          key={placed.annotation.id}
          from={placed.from}
          durationInFrames={placed.durationInFrames}
          layout="none"
        >
          <EditorialAnnotation
            placed={placed}
            periodLabel={
              placed.annotation.timing.kind === 'period'
                ? label(placed.annotation.timing.period)
                : null
            }
            theme={theme}
            layout={layout}
          />
        </Sequence>
      ))}

      {timeline.introFrames > 0 ? (
        <Sequence durationInFrames={timeline.introFrames}>
          <IntroCard
            title={config.title}
            subtitle={config.subtitle}
            description={config.metricDescription ?? dataset.dataset.description}
            details={`${metric}${unit ? ` · ${unit}` : ''} · ${firstLabel}–${lastLabel}`}
            theme={theme}
            layout={layout}
          />
        </Sequence>
      ) : null}

      {timeline.outroFrames > 0 ? (
        <Sequence from={timeline.outroStartFrame} durationInFrames={timeline.outroFrames}>
          <OutroScene
            standings={standings}
            periodLabel={lastLabel}
            metric={metric}
            format={config.valueFormat}
            headline={config.outroText}
            sources={sourceText}
            music={credits.music}
            theme={theme}
            layout={layout}
          />
        </Sequence>
      ) : null}

      {timeline.creditsFrames > 0 ? (
        <Sequence from={timeline.creditsStartFrame} durationInFrames={timeline.creditsFrames}>
          <CreditsScene
            credits={credits}
            showUrls={config.showSourceUrls}
            note={estimateNote}
            theme={theme}
            layout={layout}
          />
        </Sequence>
      ) : null}

      {config.music ? <BackgroundMusic music={config.music} /> : null}
    </AbsoluteFill>
  );
}
