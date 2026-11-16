import type {
  BarChartRaceConfig,
  NormalizedDataset,
  SourceReference,
} from '@statsopedia/shared-types';

/** Everything the video credits, deduplicated. */
export interface RaceCredits {
  /** Sources of the dataset (the CSV `source_id` and `source_url`). */
  data: SourceReference[];
  /** Sources cited by annotations, minus those already listed under data. */
  editorial: SourceReference[];
  /** Music credit line when the track's license requires attribution. */
  music: string | null;
}

const keyOf = (source: SourceReference) => `${source.name.toLowerCase()}|${source.url ?? ''}`;

export function buildCredits(
  dataset: Pick<NormalizedDataset, 'sources'>,
  config: Pick<BarChartRaceConfig, 'annotations' | 'music'>,
): RaceCredits {
  const data = dataset.sources.map((source) => ({ name: source.id, url: source.url }));
  const seen = new Set(data.map(keyOf));
  const editorial: SourceReference[] = [];
  for (const annotation of config.annotations) {
    for (const source of annotation.sources) {
      const key = keyOf(source);
      if (!seen.has(key)) {
        seen.add(key);
        editorial.push(source);
      }
    }
  }
  return { data, editorial, music: config.music?.attribution ?? null };
}

/** The compact source label under the chart: the override, or the dataset's source names. */
export function compactSourceLabel(
  dataset: Pick<NormalizedDataset, 'sources'>,
  config: Pick<BarChartRaceConfig, 'sourceText'>,
): string {
  if (config.sourceText) return config.sourceText;
  const names = dataset.sources.map((source) => source.id);
  return names.length ? `Source: ${names.join(', ')}` : '';
}

/** `https://data.worldbank.org/indicator/x` → `data.worldbank.org/indicator/x`. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
