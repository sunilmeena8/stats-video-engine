import type { VideoTheme } from '@statsopedia/video-config';
import type { ReactElement } from 'react';

import type { RaceLayout } from './layout.js';

/**
 * The current period, large. During a transition the label rolls over around the midpoint:
 * the old label slides up and fades while the new one rises into place.
 */
export function YearIndicator({
  fromLabel,
  toLabel,
  linearProgress,
  theme,
  layout,
}: {
  fromLabel: string;
  toLabel: string;
  linearProgress: number;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const { year } = layout;
  const window = 0.3; // fraction of the transition used by the roll
  const roll = Math.min(Math.max((linearProgress - (0.5 - window / 2)) / window, 0), 1);
  // A full line height, so the outgoing label leaves the clipped box completely.
  const distance = year.size * 1.3;
  const style = {
    position: 'absolute' as const,
    right: 0,
    whiteSpace: 'nowrap' as const,
    lineHeight: 1,
  };
  const same = fromLabel === toLabel;
  // Long labels ("15 Mar 2017") are smaller than plain years.
  const fontSize = fromLabel.length > 6 ? year.size * 0.55 : year.size;

  return (
    <div
      style={{
        position: 'absolute',
        top: year.top,
        ...(year.left === null ? { right: year.right } : { left: year.left }),
        width: layout.vertical ? layout.width - year.right * 2 : year.size * 3.2,
        height: year.size * 1.05,
        overflow: 'hidden',
        color: theme.textPrimary,
        fontSize,
        fontWeight: 800,
        letterSpacing: '-0.04em',
        fontVariantNumeric: 'tabular-nums',
        textAlign: layout.vertical ? 'left' : 'right',
      }}
    >
      {same ? (
        <div style={{ ...style, ...(layout.vertical ? { left: 0, right: undefined } : {}) }}>
          {fromLabel}
        </div>
      ) : (
        <>
          <div
            style={{
              ...style,
              ...(layout.vertical ? { left: 0, right: undefined } : {}),
              transform: `translateY(${-roll * distance}px)`,
              opacity: 1 - roll,
            }}
          >
            {fromLabel}
          </div>
          <div
            style={{
              ...style,
              ...(layout.vertical ? { left: 0, right: undefined } : {}),
              transform: `translateY(${(1 - roll) * distance}px)`,
              opacity: roll,
            }}
          >
            {toLabel}
          </div>
        </>
      )}
    </div>
  );
}

/** Thin progress track under the chart: where we are between the first and last period. */
export function TimelineProgress({
  position,
  periodCount,
  startLabel,
  endLabel,
  theme,
  layout,
}: {
  position: number;
  periodCount: number;
  startLabel: string;
  endLabel: string;
  theme: VideoTheme;
  layout: RaceLayout;
}): ReactElement {
  const { chart, progress, text, columns } = layout;
  const left = columns.trackLeft;
  const width = chart.left + chart.width - left;
  const fraction = periodCount > 1 ? position / (periodCount - 1) : 1;
  const thickness = Math.max(2, Math.round(layout.unit * 3));
  return (
    <div style={{ position: 'absolute', left, top: progress.top, width }}>
      <div
        style={{
          position: 'relative',
          height: thickness,
          background: theme.gridLine,
          borderRadius: thickness,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: thickness,
            width: `${fraction * 100}%`,
            background: theme.accent,
            borderRadius: thickness,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${fraction * 100}%`,
            top: thickness / 2,
            width: thickness * 4,
            height: thickness * 4,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: theme.accent,
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: text.axis * 0.6,
          color: theme.textMuted,
          fontSize: text.axis,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
