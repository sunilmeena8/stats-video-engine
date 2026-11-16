/**
 * Generates the renderer's synthetic sample dataset and normalizes it with the real
 * data-processor pipeline:
 *
 *   samples/datasets/synthetic-race.csv            (deterministic, seeded)
 *   apps/renderer/src/sample/synthetic-race.json   (NormalizedDataset)
 *
 * Every entity and number is fictional. The dataset deliberately contains a tie, late
 * entrants, an entity that disappears, a one-year gap (bridged as an estimate), a three-year
 * gap (left empty), an empty value, a zero and a very long name.
 *
 *   pnpm --filter @statsopedia/renderer sample:data
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const csvPath = path.join(repo, 'samples/datasets/synthetic-race.csv');
const jsonPath = path.join(repo, 'apps/renderer/src/sample/synthetic-race.json');

/** Small seeded PRNG (mulberry32): same seed, same numbers, on every machine. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Entity {
  id: string;
  name: string;
  category: string;
  /** Value in the first year it appears, in USD. */
  base: number;
  growth: number;
  from: number;
  to: number;
}

const START = 1990;
const END = 2024;
const entities: Entity[] = [
  {
    id: 'AUR',
    name: 'Aurelia',
    category: 'North',
    base: 1.9e12,
    growth: 0.028,
    from: START,
    to: END,
  },
  {
    id: 'BRV',
    name: 'Brevia',
    category: 'West',
    base: 1.6e12,
    growth: 0.036,
    from: START,
    to: END,
  },
  {
    id: 'CAL',
    name: 'Calderon Isles',
    category: 'South',
    base: 0.9e12,
    growth: 0.055,
    from: START,
    to: END,
  },
  {
    id: 'DRM',
    name: 'Dravmoor',
    category: 'East',
    base: 1.4e12,
    growth: 0.012,
    from: START,
    to: END,
  },
  {
    id: 'ELD',
    name: 'Eldmark',
    category: 'North',
    base: 0.7e12,
    growth: 0.047,
    from: START,
    to: END,
  },
  {
    id: 'FEN',
    name: 'Fenwick Federation',
    category: 'West',
    base: 1.1e12,
    growth: 0.022,
    from: START,
    to: END,
  },
  {
    id: 'GLD',
    name: 'Goldhaven',
    category: 'South',
    base: 0.35e12,
    growth: 0.075,
    from: START,
    to: END,
  },
  {
    id: 'HAR',
    name: 'Old Harbor Union',
    category: 'East',
    base: 1.2e12,
    growth: 0.01,
    from: START,
    to: 2012,
  },
  {
    id: 'IVR',
    name: 'Ivory Reach',
    category: 'South',
    base: 0.5e12,
    growth: 0.041,
    from: START,
    to: END,
  },
  {
    id: 'JUN',
    name: 'Juniper Coast',
    category: 'West',
    base: 0.45e12,
    growth: 0.05,
    from: START,
    to: END,
  },
  {
    id: 'KES',
    name: 'Kestrel Bay',
    category: 'East',
    base: 0.8e12,
    growth: 0.068,
    from: 2003,
    to: END,
  },
  {
    id: 'LUM',
    name: 'Lumen Republic',
    category: 'North',
    base: 1.5e12,
    growth: 0.06,
    from: 2010,
    to: END,
  },
  {
    id: 'UFN',
    name: 'United Federation of the Northern Archipelago Territories',
    category: 'North',
    base: 0.6e12,
    growth: 0.039,
    from: START,
    to: END,
  },
  {
    id: 'MRD',
    name: 'Meridian',
    category: 'South',
    base: 0.25e12,
    growth: 0.09,
    from: 1996,
    to: END,
  },
];

const random = prng(20261110);
const rows = ['entity_id,entity_name,year,value,unit,source_id,entity_category,source_url,notes'];
const quote = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

for (let year = START; year <= END; year++) {
  for (const entity of entities) {
    if (year < entity.from || year > entity.to) continue;
    if (entity.id === 'IVR' && year >= 2015 && year <= 2017) continue; // 3-year gap: left empty
    let value =
      entity.base * (1 + entity.growth) ** (year - entity.from) * (0.97 + random() * 0.06);
    // Shared shocks make the ranking move: a dip for some, a boom for others.
    if (year >= 2008 && year <= 2010 && entity.category === 'West') value *= 0.88;
    if (year >= 2018 && entity.category === 'South') value *= 1.06;
    let cell = (Math.round(value / 1e8) * 1e8).toFixed(0);
    let note = '';
    if (entity.id === 'ELD' && year === 2001) {
      cell = ''; // empty value: missing, not zero
      note = 'Value not published (synthetic)';
    }
    if (entity.id === 'MRD' && year === 1996) {
      cell = '0';
      note = 'First reported year: zero (synthetic)';
    }
    rows.push(
      [
        entity.id,
        quote(entity.name),
        String(year),
        cell,
        'USD (synthetic)',
        'statsopedia-synthetic',
        entity.category,
        year === START ? 'https://example.org/statsopedia/synthetic' : '',
        quote(note),
      ].join(','),
    );
  }
}

// A deliberate tie in 2005 between Brevia and Dravmoor.
const tieYear = '2005';
const brevia = rows.findIndex((row) => row.startsWith(`BRV,Brevia,${tieYear},`));
const dravmoor = rows.findIndex((row) => row.startsWith(`DRM,Dravmoor,${tieYear},`));
const tied = rows[brevia]!.split(',')[3]!;
rows[dravmoor] = rows[dravmoor]!.replace(/^(DRM,Dravmoor,2005,)\d+/, `$1${tied}`);

mkdirSync(path.dirname(csvPath), { recursive: true });
writeFileSync(csvPath, `${rows.join('\n')}\n`);
process.stdout.write(`Wrote ${csvPath} (${rows.length - 1} rows)\n`);

execFileSync(
  path.join(repo, 'services/data-processor/.venv/bin/python'),
  [
    '-m',
    'app.normalize_file',
    csvPath,
    jsonPath,
    '--title',
    'Synthetic Economies Index',
    '--description',
    'Fictional economies with synthetic values. Not real statistics.',
    '--max-gap',
    '1',
  ],
  { cwd: path.join(repo, 'services/data-processor'), stdio: 'inherit' },
);
