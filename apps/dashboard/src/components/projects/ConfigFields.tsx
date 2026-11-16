'use client';

import { TOP_N_MAX, TOP_N_MIN } from '@statsopedia/shared-schemas';
import {
  ANIMATION_SPEEDS,
  type AnimationSpeed,
  type OutputMode,
  type VideoThemeId,
} from '@statsopedia/shared-types';
import { useQuery } from '@tanstack/react-query';
import { VIDEO_THEMES, SECONDS_PER_YEAR } from '@statsopedia/video-config';
import { Monitor, Smartphone } from 'lucide-react';

import { Checkbox, Field, Range, Select } from '@/components/ui';
import { endpoints } from '@/lib/api/endpoints';
import { keys } from '@/lib/api/queries';

/** The periods of a dataset version (from its preview; cheap, cached). */
export function useVersionPeriods(datasetId: string | undefined, versionId: string | undefined) {
  const query = { versionId, top: 1, rowsLimit: 1, issuesLimit: 1 };
  return useQuery({
    queryKey: keys.preview(datasetId ?? '', query),
    queryFn: () => endpoints.preview(datasetId!, query),
    enabled: Boolean(datasetId && versionId),
    staleTime: Infinity,
    select: (data) => data.periods,
  });
}

export function PeriodFields({
  periods,
  startPeriod,
  endPeriod,
  onChange,
}: {
  periods: string[] | undefined;
  startPeriod: string | null;
  endPeriod: string | null;
  onChange: (range: { startPeriod: string | null; endPeriod: string | null }) => void;
}) {
  const list = periods ?? [];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Field label="Start">
        {(id) => (
          <Select
            id={id}
            value={startPeriod ?? ''}
            disabled={!list.length}
            onChange={(event) => onChange({ startPeriod: event.target.value || null, endPeriod })}
          >
            <option value="">First period{list[0] ? ` (${list[0]})` : ''}</option>
            {list.map((period) => (
              <option
                key={period}
                value={period}
                disabled={endPeriod !== null && period >= endPeriod}
              >
                {period}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="End">
        {(id) => (
          <Select
            id={id}
            value={endPeriod ?? ''}
            disabled={!list.length}
            onChange={(event) => onChange({ startPeriod, endPeriod: event.target.value || null })}
          >
            <option value="">Last period{list.at(-1) ? ` (${list.at(-1)})` : ''}</option>
            {list.map((period) => (
              <option
                key={period}
                value={period}
                disabled={startPeriod !== null && period <= startPeriod}
              >
                {period}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

export function TopNField({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label="Entities on screen (top N)" aside={value}>
      {(id) => (
        <Range
          id={id}
          min={TOP_N_MIN}
          max={TOP_N_MAX}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      )}
    </Field>
  );
}

const SPEED_LABEL: Record<AnimationSpeed, string> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
};

export function SpeedField({
  value,
  onChange,
}: {
  value: AnimationSpeed;
  onChange: (value: AnimationSpeed) => void;
}) {
  return (
    <Field label="Animation speed" hint={`${SECONDS_PER_YEAR[value]} s per period`}>
      {(id) => (
        <Select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value as AnimationSpeed)}
        >
          {ANIMATION_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {SPEED_LABEL[speed]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Dark video themes only. */
export function ThemeField({
  value,
  onChange,
}: {
  value: VideoThemeId;
  onChange: (value: VideoThemeId) => void;
}) {
  const themes = Object.values(VIDEO_THEMES).filter((theme) => theme.mode === 'dark');
  return (
    <Field label="Theme">
      {() => (
        <div
          style={{ display: 'grid', gridTemplateColumns: `repeat(${themes.length}, 1fr)`, gap: 8 }}
          role="radiogroup"
          aria-label="Theme"
        >
          {themes.map((theme) => {
            const selected = theme.id === value;
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(theme.id)}
                style={{
                  display: 'grid',
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--sp-color-text-primary)',
                  font: 'inherit',
                  background: 'var(--sp-color-surface-sunken)',
                  border: `1px solid ${selected ? 'var(--sp-color-accent)' : 'var(--sp-color-border-strong)'}`,
                  boxShadow: selected ? '0 0 0 3px var(--sp-color-accent-soft)' : undefined,
                }}
              >
                <span
                  style={{
                    height: 34,
                    borderRadius: 6,
                    background: theme.background,
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 3,
                    padding: 5,
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                  aria-hidden
                >
                  {theme.barPalette.slice(0, 5).map((color, index) => (
                    <span
                      key={color}
                      style={{
                        flex: 1,
                        height: `${90 - index * 15}%`,
                        borderRadius: 2,
                        background: color,
                      }}
                    />
                  ))}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 550 }}>{theme.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </Field>
  );
}

export function OutputFields({
  mode,
  supported,
  onChange,
}: {
  mode: OutputMode;
  /** Formats the selected template can render. */
  supported: readonly ('long' | 'short')[];
  onChange: (mode: OutputMode) => void;
}) {
  const long = mode === 'long' || mode === 'both';
  const short = mode === 'short' || mode === 'both';
  const set = (nextLong: boolean, nextShort: boolean) => {
    if (nextLong && nextShort) onChange('both');
    else if (nextLong) onChange('long');
    else if (nextShort) onChange('short');
    // At least one format stays selected.
  };
  return (
    <Field label="Output formats" hint="Long-form and Shorts are rendered and tracked separately.">
      {() => (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Checkbox
            label={
              <>
                <Monitor size={15} aria-hidden /> Long-form 16:9
              </>
            }
            checked={long}
            disabled={!supported.includes('long') || (long && !short)}
            onChange={(checked) => set(checked, short)}
          />
          <Checkbox
            label={
              <>
                <Smartphone size={15} aria-hidden /> Shorts 9:16
              </>
            }
            checked={short}
            disabled={!supported.includes('short') || (short && !long)}
            onChange={(checked) => set(long, checked)}
          />
        </div>
      )}
    </Field>
  );
}
