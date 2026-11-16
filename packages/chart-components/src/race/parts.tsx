import type { ValueFormat } from '@statsopedia/shared-types';
import { formatValue } from '@statsopedia/utils';
import type { VideoTheme } from '@statsopedia/video-config';
import type { CSSProperties, ReactElement } from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';

import type { RaceLayout } from './layout.js';
import { fitFontSize, initials, readableTextColor } from './model.js';

export const BRAND_NAME = 'Statsopedia';
export const BRAND_TAGLINE = 'The World, By The Numbers.';

const NUMERIC: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

/** http(s) and data: URLs pass through; anything else is a file in the public directory. */
export function resolveMediaSrc(src: string): string {
  return /^(https?:|data:)/.test(src) ? src : staticFile(src);
}

export function Background({ theme }: { theme: VideoTheme }): ReactElement {
  // A single, very soft vignette: depth without a visible gradient.
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.background,
        backgroundImage: `radial-gradient(120% 90% at 20% 0%, ${theme.surface} 0%, ${theme.background} 60%)`,
      }}
    />
  );
}

/** The Statsopedia mark: three ranked bars. */
export function StatsopediaMark({ size, accent }: { size: number; accent: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="6" width="24" height="5.5" rx="1.5" fill={accent} />
      <rect x="4" y="13.25" width="17" height="5.5" rx="1.5" fill={accent} opacity="0.7" />
      <rect x="4" y="20.5" width="10" height="5.5" rx="1.5" fill={accent} opacity="0.45" />
    </svg>
  );
}

export function StatsopediaBranding({
  theme,
  size,
  withTagline = true,
}: {
  theme: VideoTheme;
  size: number;
  withTagline?: boolean;
}): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.45 }}>
      <StatsopediaMark size={size * 1.5} accent={theme.accent} />
      <span
        style={{
          color: theme.textPrimary,
          fontSize: size,
          fontWeight: 700,
          letterSpacing: '-0.01em',
        }}
      >
        {BRAND_NAME}
      </span>
      {withTagline ? (
        <span style={{ color: theme.textMuted, fontSize: size * 0.9 }}>· {BRAND_TAGLINE}</span>
      ) : null}
    </div>
  );
}

export function VideoHeader({
  title,
  subtitle,
  theme,
  layout,
}: {
  title: string;
  subtitle: string | null;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const { header, padX, year } = layout;
  // Leave room for the year indicator on the right in landscape.
  const maxWidth = layout.vertical
    ? layout.width - padX * 2
    : layout.width - padX * 2 - year.size * 3;
  return (
    <div style={{ position: 'absolute', top: header.top, left: padX, maxWidth }}>
      <div
        style={{
          color: theme.textPrimary,
          fontSize: header.titleSize,
          fontWeight: 800,
          letterSpacing: '-0.025em',
          lineHeight: 1.08,
        }}
      >
        {title}
      </div>
      {subtitle ? (
        <div
          style={{
            marginTop: header.subtitleSize * 0.4,
            color: theme.textSecondary,
            fontSize: header.subtitleSize,
            lineHeight: 1.3,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

/** Metric name and unit, just above the chart. */
export function MetricLabel({
  metric,
  unit,
  theme,
  layout,
}: {
  metric: string;
  unit: string | null;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: layout.chart.top - layout.header.metricSize * 2.2,
        left: layout.padX,
        display: 'flex',
        alignItems: 'center',
        gap: layout.header.metricSize * 0.6,
        fontSize: layout.header.metricSize,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          width: layout.header.metricSize * 0.5,
          height: layout.header.metricSize * 0.5,
          borderRadius: 2,
          background: theme.accent,
        }}
      />
      <span style={{ color: theme.textSecondary, fontWeight: 600 }}>{metric}</span>
      {unit ? <span style={{ color: theme.textMuted }}>· {unit}</span> : null}
    </div>
  );
}

export function RankNumber({
  rank,
  tied,
  leader,
  theme,
  size,
  width,
}: {
  rank: number;
  tied: boolean;
  leader: boolean;
  theme: VideoTheme;
  size: number;
  width: number;
}): ReactElement {
  return (
    <div
      style={{
        width,
        flex: 'none',
        textAlign: 'right',
        paddingRight: size * 0.6,
        color: leader ? theme.accent : theme.textMuted,
        fontSize: size,
        fontWeight: leader ? 800 : 600,
        ...NUMERIC,
      }}
    >
      {rank}
      {tied ? '=' : ''}
    </div>
  );
}

/** Logo image, or a monogram in the entity's color when there is none. */
export function EntityLogo({
  name,
  imageUrl,
  color,
  size,
}: {
  name: string;
  imageUrl: string | null;
  color: string;
  size: number;
}): ReactElement {
  const frame: CSSProperties = {
    width: size,
    height: size,
    flex: 'none',
    borderRadius: '50%',
    overflow: 'hidden',
  };
  if (imageUrl) {
    return (
      <div style={{ ...frame, background: '#ffffff' }}>
        <Img
          src={resolveMediaSrc(imageUrl)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        ...frame,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color,
        color: readableTextColor(color),
        fontSize: size * 0.38,
        fontWeight: 700,
        letterSpacing: '0.02em',
      }}
    >
      {initials(name)}
    </div>
  );
}

/** Right-aligned name; long names shrink a little, then end with an ellipsis. */
export function EntityName({
  name,
  category,
  width,
  size,
  leader,
  theme,
}: {
  name: string;
  category: string | null;
  width: number;
  size: number;
  leader: boolean;
  theme: VideoTheme;
}): ReactElement {
  const fontSize = fitFontSize(name, width, size);
  return (
    <div style={{ width, flex: 'none', textAlign: 'right', lineHeight: 1.1 }}>
      <div
        style={{
          color: theme.textPrimary,
          fontSize,
          fontWeight: leader ? 700 : 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </div>
      {category ? (
        <div
          style={{
            color: theme.textMuted,
            fontSize: size * 0.58,
            marginTop: size * 0.12,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {category}
        </div>
      ) : null}
    </div>
  );
}

export function AnimatedBar({
  length,
  thickness,
  color,
  leader,
}: {
  length: number;
  thickness: number;
  color: string;
  leader: boolean;
}): ReactElement {
  return (
    <div
      style={{
        width: length,
        height: thickness,
        flex: 'none',
        background: color,
        // Flat at the baseline, rounded at the data end.
        borderRadius: `0 ${Math.min(6, thickness / 4)}px ${Math.min(6, thickness / 4)}px 0`,
        boxShadow: leader ? `0 0 ${thickness * 0.6}px ${color}66` : undefined,
      }}
    />
  );
}

/** The counter beside the bar: the bar's current (interpolated) value, formatted. */
export function AnimatedValue({
  value,
  format,
  estimated,
  theme,
  size,
}: {
  value: number;
  format: ValueFormat;
  estimated: boolean;
  theme: VideoTheme;
  size: number;
}): ReactElement {
  return (
    <div
      style={{ display: 'flex', alignItems: 'baseline', gap: size * 0.35, whiteSpace: 'nowrap' }}
    >
      <span style={{ color: theme.textPrimary, fontSize: size, fontWeight: 600, ...NUMERIC }}>
        {formatValue(value, format)}
      </span>
      {estimated ? (
        <span style={{ color: theme.textMuted, fontSize: size * 0.62, fontStyle: 'italic' }}>
          est.
        </span>
      ) : null}
    </div>
  );
}

export function SourceCredits({
  text,
  note,
  theme,
  layout,
}: {
  text: string;
  note: string;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const { footer, padX } = layout;
  return (
    <div
      style={{
        position: 'absolute',
        left: padX,
        bottom: footer.bottom,
        maxWidth: layout.vertical ? layout.width - padX * 2 : layout.width * 0.55,
        color: theme.textMuted,
        fontSize: footer.size,
        lineHeight: 1.4,
      }}
    >
      <div style={{ color: theme.textSecondary }}>{text}</div>
      <div>{note}</div>
    </div>
  );
}
