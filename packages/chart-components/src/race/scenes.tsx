import type { SourceReference, ValueFormat } from '@statsopedia/shared-types';
import { formatValue } from '@statsopedia/utils';
import type { VideoTheme } from '@statsopedia/video-config';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { displayUrl, type RaceCredits } from './credits.js';
import type { RaceLayout } from './layout.js';
import { BRAND_NAME, BRAND_TAGLINE, EntityLogo, StatsopediaMark } from './parts.js';

export interface Standing {
  id: string;
  rank: number;
  tied: boolean;
  name: string;
  imageUrl: string | null;
  color: string;
  value: number;
}

/** The outro needs at least this long to show the final ranking and then the end card. */
export const OUTRO_SPLIT_MIN_SECONDS = 3;

/** Frames of the outro given to the end card (the rest shows the final ranking). */
export function endCardFrames(outroFrames: number, fps: number): number {
  if (outroFrames < OUTRO_SPLIT_MIN_SECONDS * fps) return 0;
  return Math.round(Math.min(Math.max(outroFrames * 0.4, fps * 1.5), fps * 3));
}

function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.7),
  });
}

/** Fades the scene out over its last `seconds` (when it is followed by another scene). */
function useExit(seconds: number) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  if (seconds <= 0) return 1;
  return interpolate(frame, [durationInFrames - fps * seconds, durationInFrames - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

function Backdrop({
  theme,
  children,
  style,
}: {
  theme: VideoTheme;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(70% 60% at 50% 40%, ${theme.surface}f2 0%, ${theme.background}f7 70%, ${theme.background} 100%)`,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/**
 * The race's outcome: the winner, large, then the rest of the final top five. Ties share a rank
 * and are all named as joint winners.
 */
export function FinalRankingScene({
  standings,
  periodLabel,
  metric,
  format,
  theme,
  layout,
  fadeOut,
  footer,
}: {
  standings: Standing[];
  periodLabel: string;
  metric: string;
  format: ValueFormat;
  theme: VideoTheme;
  layout: RaceLayout;
  /** Seconds to fade out at the end (when the end card follows). */
  fadeOut: number;
  footer: ReactNode;
}): ReactElement {
  const u = layout.unit;
  const enter = useEnter();
  const exit = useExit(fadeOut);
  const winners = standings.filter((standing) => standing.rank === 1);
  const rest = standings.filter((standing) => standing.rank !== 1).slice(0, 5 - winners.length);
  const listEnter = useEnter(Math.round(8));

  return (
    <Backdrop theme={theme} style={{ opacity: Math.min(enter, exit) }}>
      <AbsoluteFill
        style={{
          padding: `${layout.vertical ? u * 200 : u * 90}px ${layout.padX * 1.3}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: u * 36,
        }}
      >
        <div
          style={{
            color: theme.accent,
            fontSize: u * 26,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Final ranking · {periodLabel}
        </div>
        {winners.length ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: u * 32,
              transform: `translateY(${(1 - enter) * u * 30}px)`,
            }}
          >
            <div style={{ display: 'flex' }}>
              {winners.slice(0, 3).map((winner, index) => (
                <div key={winner.id} style={{ marginLeft: index ? -u * 30 : 0 }}>
                  <EntityLogo
                    name={winner.name}
                    imageUrl={winner.imageUrl}
                    color={winner.color}
                    size={u * (layout.vertical ? 132 : 150)}
                  />
                </div>
              ))}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: theme.textSecondary, fontSize: u * 30, fontWeight: 600 }}>
                {winners.length > 1 ? 'Joint winners' : 'Winner'}
              </div>
              <div
                style={{
                  color: theme.textPrimary,
                  fontSize: u * (layout.vertical ? 70 : 84),
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.05,
                }}
              >
                {winners.map((winner) => winner.name).join(' & ')}
              </div>
              <div
                style={{
                  marginTop: u * 10,
                  color: theme.accent,
                  fontSize: u * 40,
                  fontWeight: 700,
                }}
              >
                {formatValue(winners[0]!.value, format)}
                <span style={{ color: theme.textMuted, fontSize: u * 24, fontWeight: 500 }}>
                  {' '}
                  · {metric}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        {rest.length ? (
          <div
            style={{
              display: 'grid',
              gap: u * 14,
              opacity: listEnter,
              maxWidth: u * 1100,
            }}
          >
            {rest.map((standing) => (
              <div
                key={standing.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `${u * 70}px ${u * 48}px 1fr auto`,
                  alignItems: 'center',
                  gap: u * 18,
                  padding: `${u * 12}px ${u * 20}px`,
                  borderRadius: u * 12,
                  background: `${theme.background}99`,
                  border: `1px solid ${theme.gridLine}`,
                  fontSize: u * 30,
                }}
              >
                <span style={{ color: theme.textMuted, fontWeight: 700 }}>
                  #{standing.rank}
                  {standing.tied ? '=' : ''}
                </span>
                <EntityLogo
                  name={standing.name}
                  imageUrl={standing.imageUrl}
                  color={standing.color}
                  size={u * 48}
                />
                <span
                  style={{
                    color: theme.textPrimary,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {standing.name}
                </span>
                <span style={{ color: theme.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                  {formatValue(standing.value, format)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </AbsoluteFill>
      {footer}
    </Backdrop>
  );
}

/** Brand, tagline and the closing line. */
export function EndCard({
  headline,
  theme,
  layout,
  footer,
}: {
  headline: string | null;
  theme: VideoTheme;
  layout: RaceLayout;
  footer: ReactNode;
}): ReactElement {
  const u = layout.unit;
  const enter = useEnter();
  return (
    <Backdrop theme={theme}>
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          padding: `0 ${layout.padX}px`,
          opacity: enter,
          transform: `scale(${0.96 + enter * 0.04})`,
        }}
      >
        <StatsopediaMark size={u * 104} accent={theme.accent} />
        <div
          style={{ marginTop: u * 26, color: theme.textPrimary, fontSize: u * 52, fontWeight: 800 }}
        >
          {BRAND_NAME}
        </div>
        <div style={{ marginTop: u * 10, color: theme.accent, fontSize: u * 34, fontWeight: 600 }}>
          {BRAND_TAGLINE}
        </div>
        {headline ? (
          <div
            style={{
              marginTop: u * 48,
              color: theme.textSecondary,
              fontSize: u * 32,
              maxWidth: u * 1400,
              lineHeight: 1.35,
            }}
          >
            {headline}
          </div>
        ) : null}
      </AbsoluteFill>
      {footer}
    </Backdrop>
  );
}

/** One small line at the bottom of the outro scenes: the compact sources and the music credit. */
export function OutroFooter({
  sources,
  music,
  theme,
  layout,
}: {
  sources: string;
  music: string | null;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: layout.padX,
        right: layout.padX,
        bottom: layout.footer.bottom,
        color: theme.textMuted,
        fontSize: layout.footer.size,
        lineHeight: 1.4,
        textAlign: 'center',
      }}
    >
      {sources ? <div>{sources}</div> : null}
      {music ? <div>Music: {music}</div> : null}
    </div>
  );
}

/** The outro: the final ranking, then the end card when there is time for both. */
export function OutroScene(props: {
  standings: Standing[];
  periodLabel: string;
  metric: string;
  format: ValueFormat;
  headline: string | null;
  sources: string;
  music: string | null;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const { fps, durationInFrames } = useVideoConfig();
  const endFrames = endCardFrames(durationInFrames, fps);
  const rankingFrames = durationInFrames - endFrames;
  const footer = (
    <OutroFooter
      sources={props.sources}
      music={props.music}
      theme={props.theme}
      layout={props.layout}
    />
  );
  return (
    <>
      <Sequence durationInFrames={rankingFrames}>
        <FinalRankingScene
          standings={props.standings}
          periodLabel={props.periodLabel}
          metric={props.metric}
          format={props.format}
          theme={props.theme}
          layout={props.layout}
          fadeOut={endFrames ? 0.4 : 0}
          footer={footer}
        />
      </Sequence>
      {endFrames ? (
        <Sequence from={rankingFrames} durationInFrames={endFrames}>
          <EndCard
            headline={props.headline}
            theme={props.theme}
            layout={props.layout}
            footer={footer}
          />
        </Sequence>
      ) : null}
    </>
  );
}

function SourceList({
  title,
  sources,
  showUrls,
  theme,
  u,
}: {
  title: string;
  sources: SourceReference[];
  showUrls: boolean;
  theme: VideoTheme;
  u: number;
}) {
  if (!sources.length) return null;
  return (
    <div style={{ display: 'grid', gap: u * 10 }}>
      <div
        style={{
          color: theme.accent,
          fontSize: u * 22,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      {sources.slice(0, 8).map((source) => (
        <div key={`${source.name}|${source.url ?? ''}`} style={{ lineHeight: 1.3 }}>
          <span style={{ color: theme.textPrimary, fontSize: u * 30, fontWeight: 600 }}>
            {source.name}
          </span>
          {showUrls && source.url ? (
            <span style={{ color: theme.textMuted, fontSize: u * 24 }}>
              {' '}
              · {displayUrl(source.url)}
            </span>
          ) : null}
        </div>
      ))}
      {sources.length > 8 ? (
        <div style={{ color: theme.textMuted, fontSize: u * 24 }}>
          and {sources.length - 8} more
        </div>
      ) : null}
    </div>
  );
}

/** Closing scene listing the data sources, the sources of editorial notes, and music credits. */
export function CreditsScene({
  credits,
  showUrls,
  note,
  theme,
  layout,
}: {
  credits: RaceCredits;
  showUrls: boolean;
  /** How values were prepared, e.g. that they are animated between data points. */
  note: string;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const u = layout.unit;
  const enter = useEnter();
  return (
    <AbsoluteFill style={{ background: theme.background }}>
      <AbsoluteFill
        style={{
          padding: `${layout.vertical ? u * 200 : u * 110}px ${layout.padX * 1.3}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: u * 40,
          opacity: enter,
        }}
      >
        <div
          style={{
            color: theme.textPrimary,
            fontSize: u * 56,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          Sources
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: layout.vertical ? '1fr' : 'repeat(auto-fit, minmax(0, 1fr))',
            gap: u * 48,
          }}
        >
          <SourceList title="Data" sources={credits.data} showUrls={showUrls} theme={theme} u={u} />
          <SourceList
            title="Editorial notes"
            sources={credits.editorial}
            showUrls={showUrls}
            theme={theme}
            u={u}
          />
        </div>
        {credits.music ? (
          <div style={{ display: 'grid', gap: u * 10 }}>
            <div
              style={{
                color: theme.accent,
                fontSize: u * 22,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              Music
            </div>
            <div style={{ color: theme.textPrimary, fontSize: u * 28 }}>{credits.music}</div>
          </div>
        ) : null}
        <div style={{ color: theme.textMuted, fontSize: u * 22, maxWidth: u * 1400 }}>{note}</div>
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: layout.padX,
          bottom: layout.footer.bottom,
          display: 'flex',
          alignItems: 'center',
          gap: u * 14,
          color: theme.textSecondary,
          fontSize: u * 24,
          fontWeight: 700,
        }}
      >
        <StatsopediaMark size={u * 36} accent={theme.accent} />
        {BRAND_NAME}
      </div>
    </AbsoluteFill>
  );
}
