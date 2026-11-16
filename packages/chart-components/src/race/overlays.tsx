import type { RaceMusic } from '@statsopedia/shared-types';
import { crossfadeGain, planMusic, type VideoTheme } from '@statsopedia/video-config';
import { useMemo, type CSSProperties, type ReactElement } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  ANNOTATION_KIND_LABEL,
  ANNOTATION_MAX_LINES,
  annotationTypography,
  type PlacedAnnotation,
} from './annotations.js';
import type { RaceLayout } from './layout.js';
import { musicVolumeAt } from './model.js';
import { BRAND_NAME, StatsopediaMark, resolveMediaSrc } from './parts.js';

const clampLines = (lines: number): CSSProperties => ({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: lines,
  overflow: 'hidden',
});

/**
 * Editorial note (a milestone, a ranking change, a caption…) at the place and time chosen by
 * `planAnnotations`. Render inside a <Sequence> covering its window. Springs in, fades out over
 * its last half second, and cites its sources on the card.
 */
export function EditorialAnnotation({
  placed,
  periodLabel,
  theme,
  layout,
}: {
  placed: PlacedAnnotation;
  /** Shown beside the kind label, e.g. "Milestone · 2008". */
  periodLabel: string | null;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { annotation, rect, slot } = placed;
  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.6),
  });
  const exit = interpolate(frame, [durationInFrames - fps * 0.5, durationInFrames - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const type = annotationTypography(layout);
  const unit = layout.unit;
  const bottom = slot === 'banner' || slot.startsWith('bottom');
  const kindLabel = ANNOTATION_KIND_LABEL[annotation.kind];
  const label = [kindLabel, periodLabel].filter(Boolean).join(' · ');

  const look: CSSProperties =
    annotation.style === 'callout' && slot !== 'header'
      ? {
          background: `${theme.background}d9`,
          borderLeft: `${Math.max(3, unit * 4)}px solid ${theme.accent}`,
          borderRadius: unit * 6,
          padding: `${type.padY}px ${type.padX}px`,
        }
      : {
          background: theme.surface,
          border: `1px solid ${theme.gridLine}`,
          borderRadius: unit * 14,
          padding: `${type.padY}px ${type.padX}px`,
          boxShadow: `0 ${unit * 16}px ${unit * 48}px rgba(0,0,0,0.35)`,
        };

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.left,
        width: rect.width,
        // Anchored to the edge it was planned against, so the card never grows into the bars.
        ...(bottom
          ? { bottom: layout.height - (rect.top + rect.height) }
          : { top: rect.top, minHeight: slot === 'header' ? rect.height : undefined }),
        maxHeight: slot === 'header' ? undefined : rect.height,
        boxSizing: 'border-box',
        overflow: 'hidden',
        ...look,
        display: 'flex',
        gap: type.imageGap,
        alignItems: 'flex-start',
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * unit * (bottom ? 24 : -24)}px)`,
      }}
    >
      {annotation.imageUrl ? (
        <Img
          src={resolveMediaSrc(annotation.imageUrl)}
          style={{
            width: type.imageSize,
            height: type.imageSize,
            objectFit: 'cover',
            borderRadius: unit * 10,
            flex: 'none',
          }}
        />
      ) : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        {label || annotation.icon ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: unit * 10,
              color: theme.accent,
              fontSize: type.label,
              lineHeight: 1.4,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {annotation.icon ? (
              <span style={{ fontSize: type.label * 1.2 }}>{annotation.icon}</span>
            ) : null}
            <span>{label}</span>
          </div>
        ) : null}
        <div
          style={{
            marginTop: type.gap,
            color: theme.textPrimary,
            fontSize: type.title,
            fontWeight: 700,
            lineHeight: 1.2,
            ...clampLines(ANNOTATION_MAX_LINES.title),
          }}
        >
          {annotation.title}
        </div>
        {annotation.text ? (
          <div
            style={{
              marginTop: type.gap,
              color: theme.textSecondary,
              fontSize: type.text,
              lineHeight: 1.4,
              ...clampLines(ANNOTATION_MAX_LINES.text),
            }}
          >
            {annotation.text}
          </div>
        ) : null}
        {annotation.sources.length ? (
          <div
            style={{
              marginTop: type.gap,
              color: theme.textMuted,
              fontSize: type.source,
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Source: {annotation.sources.map((source) => source.name).join(', ')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Background music for the whole composition. A track shorter than the video repeats with
 * linear crossfades (no seam, no summed overshoot); a longer one is cut after the fade-out.
 * The volume fades in and out over the whole video and never exceeds the configured volume
 * (≤ 1, already lowered for hot masters), so the music is never amplified.
 */
export function BackgroundMusic({ music }: { music: RaceMusic }): ReactElement {
  const { fps, durationInFrames } = useVideoConfig();
  const plan = useMemo(
    () => planMusic(music, { fps, durationInFrames }),
    [music, fps, durationInFrames],
  );
  const src = resolveMediaSrc(music.src);
  const envelope = (frame: number) => musicVolumeAt(frame, music, { fps, durationInFrames });
  if (plan.coverage === 'unknown') {
    // Length not measured: Remotion's own loop (no crossfade), with the same envelope.
    return <Audio src={src} loop={music.loop} loopVolumeCurveBehavior="extend" volume={envelope} />;
  }
  return (
    <>
      {plan.segments.map((segment) => (
        <Sequence
          key={segment.from}
          from={segment.from}
          durationInFrames={segment.durationInFrames}
          layout="none"
        >
          <Audio
            src={src}
            volume={(local) => envelope(segment.from + local) * crossfadeGain(segment, local)}
          />
        </Sequence>
      ))}
    </>
  );
}

/** Opening card. Render inside a <Sequence> covering the intro. */
export function IntroCard({
  title,
  subtitle,
  description,
  details,
  theme,
  layout,
}: {
  title: string;
  subtitle: string | null;
  /** What is measured, in a sentence. */
  description: string | null;
  /** Metric, unit and period range. */
  details: string;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const u = layout.unit;
  const rise = (delay: number) =>
    spring({
      frame: frame - delay,
      fps,
      config: { damping: 200 },
      durationInFrames: Math.round(fps * 0.8),
    });
  const exit = interpolate(frame, [durationInFrames - fps * 0.6, durationInFrames - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const item = (delay: number): CSSProperties => ({
    opacity: rise(delay),
    transform: `translateY(${(1 - rise(delay)) * u * 30}px)`,
  });
  return (
    <AbsoluteFill
      style={{
        opacity: exit,
        justifyContent: 'center',
        padding: `0 ${layout.padX * 1.4}px`,
        background: theme.background,
      }}
    >
      <div style={{ ...item(0), display: 'flex', alignItems: 'center', gap: u * 18 }}>
        <StatsopediaMark size={u * 64} accent={theme.accent} />
        <span
          style={{
            color: theme.textPrimary,
            fontSize: u * 40,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          {BRAND_NAME}
        </span>
      </div>
      <div
        style={{
          ...item(6),
          marginTop: u * 48,
          color: theme.textPrimary,
          fontSize: u * (layout.vertical ? 84 : 92),
          fontWeight: 800,
          letterSpacing: '-0.035em',
          lineHeight: 1.04,
          maxWidth: u * 1500,
        }}
      >
        {title}
      </div>
      {subtitle ? (
        <div
          style={{
            ...item(10),
            marginTop: u * 20,
            color: theme.textSecondary,
            fontSize: u * 34,
            lineHeight: 1.3,
          }}
        >
          {subtitle}
        </div>
      ) : null}
      {description ? (
        <div
          style={{
            ...item(12),
            marginTop: u * 28,
            color: theme.textSecondary,
            fontSize: u * 28,
            lineHeight: 1.4,
            maxWidth: u * 1300,
            ...clampLines(3),
          }}
        >
          {description}
        </div>
      ) : null}
      <div
        style={{
          ...item(14),
          marginTop: u * 40,
          display: 'flex',
          alignItems: 'center',
          gap: u * 16,
          color: theme.textMuted,
          fontSize: u * 26,
        }}
      >
        <span style={{ width: u * 48, height: Math.max(2, u * 3), background: theme.accent }} />
        {details}
      </div>
    </AbsoluteFill>
  );
}
