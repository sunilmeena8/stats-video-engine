/**
 * Measures music uploaded before tracks were analysed (length, codec, true peak, loudness), so
 * the quality checks can use them: `pnpm --filter @statsopedia/api media:analyze`. Tracks that
 * cannot be decoded are reported and left unchanged.
 */
import type { AudioAnalysis } from '@statsopedia/shared-types';
import { LocalStorage, createLogger, loadEnvFile } from '@statsopedia/utils/node';
import pg from 'pg';

import { loadConfig } from '../config.js';
import { createAudioAnalyzer } from '../media/audio.js';

loadEnvFile();
const config = loadConfig(process.env);
const logger = createLogger({ service: 'api-media-analyze', level: config.LOG_LEVEL });
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
const storage = new LocalStorage(config.STORAGE_ROOT);
const analyzer = createAudioAnalyzer();

try {
  const { rows } = await pool.query<{ id: string; name: string; storage_key: string }>(
    `SELECT id, name, storage_key FROM media_assets WHERE type = 'music' AND audio IS NULL`,
  );
  let analysed = 0;
  for (const row of rows) {
    try {
      const report = await analyzer.analyze(storage.resolve(row.storage_key));
      const audio: AudioAnalysis = {
        codec: report.codec,
        sampleRate: report.sampleRate,
        channels: report.channels,
        truePeakDbtp: report.truePeakDbtp,
        integratedLufs: report.integratedLufs,
      };
      await pool.query(
        `UPDATE media_assets SET duration_seconds = $2, audio = $3, updated_at = now() WHERE id = $1`,
        [row.id, report.durationSeconds, JSON.stringify(audio)],
      );
      analysed++;
      logger.info({ asset: row.id, name: row.name, ...report }, 'Analysed');
    } catch (error) {
      logger.warn({ asset: row.id, name: row.name, err: error }, 'Could not analyse');
    }
  }
  logger.info({ analysed, total: rows.length }, 'Music analysis complete');
} catch (error) {
  logger.error({ err: error }, 'Music analysis failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
