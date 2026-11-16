/**
 * Renders a bar chart race MP4 from a normalized dataset and a config, and writes a sidecar
 * `<output>.json` with provenance: dataset version and checksum, sources, render settings,
 * the MP4's checksum and the music's licensing metadata.
 *
 *   tsx scripts/render-race.ts --dataset <normalized.json> --config <config.json> --out <file.mp4>
 *       [--music <music.json>] [--format long|short] [--frames 0-299]
 *
 * The music file may carry a `license` object; it is written to the sidecar and never passed to
 * the composition, so licensing data stays outside the rendered video.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { barChartRacePropsSchema, raceMusicSchema } from '@statsopedia/shared-schemas';
import { z } from 'zod';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const musicManifestSchema = raceMusicSchema.extend({
  license: z
    .object({
      title: z.string().min(1),
      author: z.string().min(1),
      license: z.string().min(1),
      url: z.url().nullable(),
      attributionRequired: z.boolean(),
    })
    .strict(),
});

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    config: { type: 'string' },
    music: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string' },
    frames: { type: 'string' },
  },
});
if (!values.dataset || !values.config || !values.out) {
  process.stderr.write(
    'Usage: render-race --dataset <json> --config <json> --out <mp4> [--music <json>]\n',
  );
  process.exit(2);
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(path.resolve(file), 'utf8'));

const music = values.music ? musicManifestSchema.parse(readJson(values.music)) : null;
if (music && !/^https?:/.test(music.src) && !existsSync(path.join(root, 'public', music.src))) {
  process.stderr.write(`Music file public/${music.src} not found (run \`pnpm sample:music\`)\n`);
  process.exit(1);
}
const { license, ...compositionMusic } = music ?? { license: null };

const rawConfig = readJson(values.config) as Record<string, unknown>;
const config = {
  ...rawConfig,
  ...(values.format
    ? { outputFormat: values.format, topN: values.format === 'short' ? 8 : rawConfig.topN }
    : {}),
  music: music ? compositionMusic : null,
};
// Validate exactly what the composition will receive (it validates again in calculateMetadata).
const parsed = barChartRacePropsSchema.safeParse({ dataset: readJson(values.dataset), config });
if (!parsed.success) {
  process.stderr.write(`Invalid render input:\n${z.prettifyError(parsed.error)}\n`);
  process.exit(1);
}
const props = parsed.data;

const output = path.resolve(values.out);
mkdirSync(path.dirname(output), { recursive: true });
const propsFile = path.join(tmpdir(), `statsopedia-race-${process.pid}.json`);
writeFileSync(propsFile, JSON.stringify(props));

const started = Date.now();
const args = [
  'exec',
  'remotion',
  'render',
  'src/index.ts',
  'BarChartRace',
  output,
  `--props=${propsFile}`,
  '--codec=h264',
  '--log=warn',
  ...(values.frames ? [`--frames=${values.frames}`] : []),
];
const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' });
rmSync(propsFile, { force: true });
if (result.status !== 0) process.exit(result.status ?? 1);

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sidecar = {
  output: path.basename(output),
  outputSha256: sha256(output),
  renderedAt: new Date().toISOString(),
  renderSeconds: Math.round((Date.now() - started) / 100) / 10,
  composition: 'BarChartRace',
  settings: {
    outputFormat: props.config.outputFormat,
    resolution: props.config.resolution,
    fps: props.config.fps,
    theme: props.config.theme,
    topN: props.config.topN,
    timing: props.config.timing,
  },
  dataset: {
    id: props.dataset.dataset.id,
    versionId: props.dataset.dataset.versionId,
    version: props.dataset.dataset.version,
    title: props.dataset.dataset.title,
    checksumSha256: props.dataset.dataset.checksumSha256,
    periods: `${props.dataset.timeRange.start}–${props.dataset.timeRange.end}`,
  },
  sources: props.dataset.sources,
  music: music ? { src: music.src, volume: music.volume, license } : null,
};
writeFileSync(`${output}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
process.stdout.write(`Rendered ${output}\nSidecar ${output}.json\n`);
