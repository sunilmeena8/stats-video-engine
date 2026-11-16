import { formatCompactNumber } from '@statsopedia/utils';
import type { CSSProperties, ReactElement } from 'react';

import type { RankedBar } from './ranking.js';

/** The subset of a video theme the chart needs. Structurally compatible with `VideoTheme`. */
export interface ChartTheme {
  textPrimary: string;
  textSecondary: string;
  gridLine: string;
  fontFamily: string;
}

export interface RankedBarChartProps {
  bars: readonly RankedBar[];
  /** Number of visible slots; sets the row height. */
  topN: number;
  width: number;
  height: number;
  theme: ChartTheme;
  /** Value that fills the whole bar track. Defaults to the largest visible value. */
  maxValue?: number;
  formatValue?: (value: number) => string;
}

/** Share of the width reserved for entity names (left) and value labels (right). */
const LABEL_COLUMN = 0.24;
const VALUE_GUTTER = 0.14;
/** Mark spec: rounded data-end, flat baseline end. */
const BAR_END_RADIUS = 4;

/**
 * Horizontal ranked bar chart. Stateless: the caller decides each frame's bars (e.g. via
 * `interpolateRanking`), so it works the same in Remotion, a dashboard preview, or a test.
 * Every bar is direct-labelled with its name and value, so identity never relies on color.
 */
export function RankedBarChart({
  bars,
  topN,
  width,
  height,
  theme,
  maxValue,
  formatValue = (value) => formatCompactNumber(value),
}: RankedBarChartProps): ReactElement {
  const rowHeight = height / topN;
  const barGap = Math.max(2, rowHeight * 0.18);
  const barThickness = rowHeight - barGap;
  const labelWidth = width * LABEL_COLUMN;
  const trackWidth = width - labelWidth - width * VALUE_GUTTER;
  const scaleMax = maxValue ?? Math.max(0, ...bars.map((bar) => bar.value));
  // Bounded by bar thickness and by width, so labels fit the label column in tall/narrow
  // (9:16) layouts where rows are thick but the chart is narrow.
  const fontSize = Math.min(Math.max(barThickness * 0.42, 12), width * 0.035, 56);

  const containerStyle: CSSProperties = {
    position: 'relative',
    width,
    height,
    fontFamily: theme.fontFamily,
    overflow: 'hidden',
  };

  return (
    <div style={containerStyle} role="img" aria-label="Ranked bar chart">
      {/* Recessive baseline the bars grow from. */}
      <div
        style={{
          position: 'absolute',
          left: labelWidth,
          top: 0,
          width: 1,
          height,
          backgroundColor: theme.gridLine,
        }}
      />
      {bars.map((bar) => {
        const barWidth = scaleMax > 0 ? Math.max(0, (bar.value / scaleMax) * trackWidth) : 0;
        return (
          <div
            key={bar.id}
            data-bar-id={bar.id}
            style={{
              position: 'absolute',
              left: 0,
              top: bar.position * rowHeight + barGap / 2,
              width,
              height: barThickness,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: labelWidth,
                paddingRight: fontSize * 0.6,
                boxSizing: 'border-box',
                textAlign: 'right',
                color: theme.textPrimary,
                fontSize,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {bar.label}
            </div>
            <div
              style={{
                width: barWidth,
                height: '100%',
                backgroundColor: bar.color,
                borderRadius: `0 ${BAR_END_RADIUS}px ${BAR_END_RADIUS}px 0`,
              }}
            />
            <div
              style={{
                paddingLeft: fontSize * 0.5,
                color: theme.textSecondary,
                fontSize: fontSize * 0.9,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {formatValue(bar.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
