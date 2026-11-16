import type { ValueFormat } from '@statsopedia/shared-types';
import { formatValue } from '@statsopedia/utils';
import type { VideoTheme } from '@statsopedia/video-config';
import type { ReactElement } from 'react';

import type { RaceLayout } from './layout.js';
import { axisTicks, barFraction, type RaceBar, type RaceEntity, type RaceFrame } from './model.js';
import { AnimatedBar, AnimatedValue, EntityLogo, EntityName, RankNumber } from './parts.js';

export interface RankingRowProps {
  bar: RaceBar;
  entity: RaceEntity;
  scaleMax: number;
  layout: RaceLayout;
  theme: VideoTheme;
  format: ValueFormat;
  showLogos: boolean;
  markEstimates: boolean;
}

/** One entity's row. Positioned by its (fractional) slot, so it glides between ranks. */
export function RankingRow({
  bar,
  entity,
  scaleMax,
  layout,
  theme,
  format,
  showLogos,
  markEstimates,
}: RankingRowProps): ReactElement {
  const { chart, columns, text } = layout;
  const leader = bar.rank === 1 && bar.slot < 0.5;
  const length = barFraction(bar.value, scaleMax) * columns.trackWidth;
  return (
    <div
      style={{
        position: 'absolute',
        left: chart.left,
        top: chart.rowsTop + bar.slot * chart.rowHeight,
        height: chart.rowHeight,
        width: chart.width,
        display: 'flex',
        alignItems: 'center',
        opacity: bar.opacity,
      }}
    >
      <RankNumber
        rank={bar.rank}
        tied={bar.tied}
        leader={leader}
        theme={theme}
        size={text.rank}
        width={columns.rankWidth}
      />
      {showLogos ? (
        <EntityLogo
          name={entity.name}
          imageUrl={entity.imageUrl}
          color={entity.color}
          size={columns.logoSize}
        />
      ) : (
        <div style={{ width: columns.logoSize, flex: 'none' }} />
      )}
      <div style={{ width: columns.gap, flex: 'none' }} />
      <EntityName
        name={entity.name}
        category={entity.category}
        width={columns.nameWidth}
        size={text.name}
        leader={leader}
        theme={theme}
      />
      <div style={{ width: columns.gap, flex: 'none' }} />
      <AnimatedBar
        length={length}
        thickness={chart.barThickness}
        color={entity.color}
        leader={leader}
      />
      <div style={{ width: columns.gap * 0.75, flex: 'none' }} />
      <AnimatedValue
        value={bar.value}
        format={format}
        estimated={markEstimates && bar.estimated}
        theme={theme}
        size={text.value}
      />
    </div>
  );
}

export interface RankingContainerProps {
  frame: RaceFrame;
  entities: ReadonlyMap<string, RaceEntity>;
  layout: RaceLayout;
  theme: VideoTheme;
  format: ValueFormat;
  showLogos: boolean;
  markEstimates: boolean;
  emptyLabel: string;
}

/** Gridlines with value ticks, then one row per visible entity, keyed by entity id. */
export function RankingContainer({
  frame,
  entities,
  layout,
  theme,
  format,
  showLogos,
  markEstimates,
  emptyLabel,
}: RankingContainerProps): ReactElement {
  const { chart, columns, text } = layout;
  // Roughly one labelled tick per seven characters of axis text, so labels never collide.
  const ticks = axisTicks(
    frame.scaleMax,
    Math.min(5, Math.max(2, Math.round(columns.trackWidth / (text.axis * 7)))),
  );
  // Fewest decimals that keep every tick label distinct: "$1T $2T", but "$0.5T $1.0T".
  const tickFormat: ValueFormat = { ...format, decimals: 2 };
  for (const decimals of [0, 1]) {
    const labels = ticks.map((tick) => formatValue(tick.value, { ...format, decimals }));
    if (new Set(labels).size === labels.length) {
      tickFormat.decimals = decimals;
      break;
    }
  }
  return (
    <>
      {ticks.map((tick) => {
        const x = columns.trackLeft + tick.fraction * columns.trackWidth;
        return (
          <div key={tick.value} style={{ opacity: tick.opacity }}>
            <div
              style={{
                position: 'absolute',
                left: x,
                top: chart.top + text.axis * 1.5,
                width: 1,
                height: chart.height - text.axis * 1.5,
                background: theme.gridLine,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: x,
                top: chart.top,
                transform: 'translateX(-50%)',
                color: theme.textMuted,
                fontSize: text.axis,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {formatValue(tick.value, tickFormat)}
            </div>
          </div>
        );
      })}
      {frame.bars.map((bar) => {
        const entity = entities.get(bar.id);
        if (!entity) return null;
        return (
          <RankingRow
            key={bar.id}
            bar={bar}
            entity={entity}
            scaleMax={frame.scaleMax}
            layout={layout}
            theme={theme}
            format={format}
            showLogos={showLogos}
            markEstimates={markEstimates}
          />
        );
      })}
      {frame.bars.length === 0 ? (
        <div
          style={{
            position: 'absolute',
            left: chart.left,
            top: chart.rowsTop,
            width: chart.width,
            height: chart.height - (chart.rowsTop - chart.top),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.textMuted,
            fontSize: text.name,
          }}
        >
          {emptyLabel}
        </div>
      ) : null}
    </>
  );
}
