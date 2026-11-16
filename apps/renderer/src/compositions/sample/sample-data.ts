/**
 * SYNTHETIC data for the sample composition. It exists only to verify the render pipeline and
 * must never be presented as real statistics. Real compositions receive processed dataset
 * versions as input props.
 */
export const SAMPLE_START_YEAR = 2018;
export const SAMPLE_END_YEAR = 2023;
export const SAMPLE_SOURCE_LABEL = 'Synthetic sample data — not real statistics';

interface SampleEntity {
  id: string;
  label: string;
  /** Value in the first year, in millions. */
  base: number;
  /** Compound yearly growth rate. */
  growth: number;
}

// Eight entities = eight distinct palette slots, so no two bars ever share a color.
const ENTITIES: readonly SampleEntity[] = [
  { id: 'aurora', label: 'Aurora', base: 100, growth: 0.02 },
  { id: 'borealis', label: 'Borealis', base: 90, growth: 0.06 },
  { id: 'cascade', label: 'Cascade', base: 80, growth: 0.1 },
  { id: 'delta', label: 'Delta', base: 75, growth: -0.04 },
  { id: 'ember', label: 'Ember', base: 60, growth: 0.15 },
  { id: 'fjord', label: 'Fjord', base: 55, growth: 0.03 },
  { id: 'glacier', label: 'Glacier', base: 50, growth: 0.13 },
  { id: 'harbor', label: 'Harbor', base: 45, growth: 0.2 },
];

export interface SampleEntityInfo {
  id: string;
  label: string;
  /** Stable index used for palette color assignment. */
  index: number;
}

export const SAMPLE_ENTITIES: readonly SampleEntityInfo[] = ENTITIES.map(
  ({ id, label }, index) => ({
    id,
    label,
    index,
  }),
);

/** One snapshot per year: entity id → value. */
export const SAMPLE_SNAPSHOTS: ReadonlyArray<ReadonlyMap<string, number>> = Array.from(
  { length: SAMPLE_END_YEAR - SAMPLE_START_YEAR + 1 },
  (_, step) =>
    new Map(
      ENTITIES.map((entity) => [
        entity.id,
        Math.round(entity.base * (1 + entity.growth) ** step * 1_000_000),
      ]),
    ),
);
