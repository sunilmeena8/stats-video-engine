import { createHash, randomUUID } from 'node:crypto';

import {
  MUSIC_MAX_SECONDS,
  MUSIC_MIN_SECONDS,
  mediaAssetTypeSchema,
  mediaUploadQuerySchema,
  musicCategorySchema,
  updateMediaRequestSchema,
} from '@statsopedia/shared-schemas';
import type {
  AudioAnalysis,
  LicenseType,
  MediaAsset,
  MediaAssetType,
  MusicCategory,
  MusicLicenseSnapshot,
} from '@statsopedia/shared-types';
import { storageKeys, type LocalStorage } from '@statsopedia/utils/node';
import express, { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';

import { currentUser, requireRole } from '../auth/middleware.js';
import type { Queryable } from '../db/database.js';
import { HttpError, notFound, unprocessable } from '../errors.js';
import { sanitizeFilename } from '../datasets/uploads.js';
import { sendStorageFile } from '../http/files.js';
import { AudioAnalysisError, type AudioAnalyzer } from './audio.js';

interface Sniffed {
  mimeType: string;
  extension: string;
}

/**
 * Identifies an upload by its bytes (never by name or Content-Type). Only formats the renderer
 * can use are accepted; SVG and anything executable are refused.
 */
export function sniffMedia(data: Buffer): Sniffed | null {
  const ascii = (start: number, end: number) => data.subarray(start, end).toString('latin1');
  if (data.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
    return { mimeType: 'audio/wav', extension: 'wav' };
  if (ascii(0, 3) === 'ID3' || (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0))
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (ascii(0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' };
  if (ascii(4, 8) === 'ftyp' && ['M4A ', 'M4B '].includes(ascii(8, 12)))
    return { mimeType: 'audio/mp4', extension: 'm4a' };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mimeType: 'image/png', extension: 'png' };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
    return { mimeType: 'image/webp', extension: 'webp' };
  if (ascii(0, 4) === 'wOF2') return { mimeType: 'font/woff2', extension: 'woff2' };
  return null;
}

const ALLOWED: Record<MediaAssetType, readonly string[]> = {
  music: ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/mp4'],
  logo: ['image/png', 'image/jpeg', 'image/webp'],
  image: ['image/png', 'image/jpeg', 'image/webp'],
  thumbnail: ['image/jpeg', 'image/png', 'image/webp'],
  font: ['font/woff2'],
};

/** Image size from the PNG header (other formats report null). */
function pngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || data.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Duration of a PCM WAV from its header (other formats report null). */
function wavDuration(data: Buffer): number | null {
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= data.length) {
    const id = data.toString('latin1', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 16 <= data.length) byteRate = data.readUInt32LE(offset + 16);
    if (id === 'data') return byteRate > 0 ? Math.round((size / byteRate) * 1000) / 1000 : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

interface MediaRow {
  id: string;
  type: MediaAssetType;
  name: string;
  storage_key: string;
  mime_type: string;
  file_format: string;
  category: MusicCategory | null;
  audio: AudioAnalysis | null;
  license_type: LicenseType | null;
  commercial_use: boolean | null;
  attribution_required: boolean;
  license_reference: string | null;
  size_bytes: string;
  checksum_sha256: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  attribution: string | null;
  license: string | null;
  created_at: Date;
  updated_at: Date;
}

const toAsset = (row: MediaRow): MediaAsset => ({
  id: row.id,
  type: row.type,
  name: row.name,
  mimeType: row.mime_type,
  fileFormat: row.file_format,
  fileSizeBytes: Number(row.size_bytes),
  checksumSha256: row.checksum_sha256,
  durationSeconds: row.duration_seconds,
  width: row.width,
  height: row.height,
  category: row.category,
  audio: row.audio,
  licenseType: row.license_type,
  license: row.license,
  commercialUse: row.commercial_use,
  attributionRequired: row.attribution_required,
  attribution: row.attribution,
  licenseReference: row.license_reference,
  uploadedAt: row.created_at.toISOString(),
  downloadUrl: `/api/media/${row.id}/file`,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Internal: the asset plus its storage key (never sent to clients). */
export async function getMediaRecord(
  db: Queryable,
  id: string,
  lock = false,
): Promise<(MediaAsset & { storageKey: string }) | null> {
  const { rows } = await db.query<MediaRow>(
    `SELECT * FROM media_assets WHERE id = $1${lock ? ' FOR SHARE' : ''}`,
    [id],
  );
  return rows[0] ? { ...toAsset(rows[0]), storageKey: rows[0].storage_key } : null;
}

/** The licensing of a music asset, as recorded with a render. */
export function musicLicenseSnapshot(asset: MediaAsset): MusicLicenseSnapshot {
  return {
    assetId: asset.id,
    name: asset.name,
    checksumSha256: asset.checksumSha256,
    licenseType: asset.licenseType,
    license: asset.license,
    commercialUse: asset.commercialUse,
    attributionRequired: asset.attributionRequired,
    attribution: asset.attribution,
    licenseReference: asset.licenseReference,
  };
}

const formatSeconds = (value: number) =>
  value >= 60 ? `${Math.floor(value / 60)} min ${Math.round(value % 60)} s` : `${value} s`;

export function createMediaRouter({
  pool,
  storage,
  maxUploadBytes,
  audio,
}: {
  pool: pg.Pool;
  storage: LocalStorage;
  maxUploadBytes: number;
  audio: AudioAnalyzer;
}): Router {
  const router = Router();
  const listQuery = z
    .object({ type: mediaAssetTypeSchema.optional(), category: musicCategorySchema.optional() })
    .strict();
  const idParams = z.object({ id: z.uuid() });

  router.get('/', async (req, res) => {
    const { type, category } = listQuery.parse(req.query);
    const where: string[] = [];
    const params: string[] = [];
    if (type) where.push(`type = $${params.push(type)}`);
    if (category) where.push(`category = $${params.push(category)}`);
    const { rows } = await pool.query<MediaRow>(
      `SELECT * FROM media_assets ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT 500`,
      params,
    );
    res.json({ assets: rows.map(toAsset) });
  });

  // Corrects the name, category or licensing. The file itself is immutable.
  router.patch('/:id', requireRole('editor'), express.json(), async (req, res) => {
    const { id } = idParams.parse(req.params);
    const patch = updateMediaRequestSchema.parse(req.body);
    const record = await getMediaRecord(pool, id);
    if (!record) throw notFound('Media asset');
    const merged = { ...record, ...patch };
    if (merged.category !== null && merged.type !== 'music') {
      throw unprocessable('CATEGORY_NOT_MUSIC', 'Only music has a category');
    }
    if (merged.attributionRequired && !merged.attribution) {
      throw unprocessable(
        'ATTRIBUTION_TEXT_REQUIRED',
        'Enter the credit line the license requires',
      );
    }
    const { rows } = await pool.query<MediaRow>(
      `UPDATE media_assets SET name = $2, category = $3, license_type = $4, license = $5,
         commercial_use = $6, attribution_required = $7, attribution = $8, license_reference = $9,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        merged.name,
        merged.category,
        merged.licenseType,
        merged.license,
        merged.commercialUse,
        merged.attributionRequired,
        merged.attribution,
        merged.licenseReference,
      ],
    );
    res.json(toAsset(rows[0]!));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const record = await getMediaRecord(pool, id);
    if (!record) throw notFound('Media asset');
    const { storageKey: _storageKey, ...asset } = record;
    res.json(asset);
  });

  router.get('/:id/file', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const record = await getMediaRecord(pool, id);
    if (!record) throw notFound('Media asset');
    await sendStorageFile(req, res, storage, record.storageKey, record.mimeType, `${record.name}`);
  });

  // Raw body upload: POST /api/media?type=music&filename=pad.wav
  router.post(
    '/',
    requireRole('editor'),
    express.raw({ type: () => true, limit: maxUploadBytes }),
    async (req, res) => {
      const query = mediaUploadQuerySchema.parse(req.query);
      const data = req.body as unknown;
      if (!Buffer.isBuffer(data) || data.length === 0) {
        throw new HttpError(400, 'EMPTY_FILE', 'Send the file as the raw request body');
      }
      const sniffed = sniffMedia(data);
      if (!sniffed || !ALLOWED[query.type].includes(sniffed.mimeType)) {
        throw new HttpError(
          415,
          'INVALID_FILE_TYPE',
          `Unsupported file for ${query.type}; allowed: ${ALLOWED[query.type].join(', ')}`,
        );
      }
      const id = randomUUID();
      const key = storageKeys.mediaAsset(query.type, id, sniffed.extension);
      await storage.writeNew(key, data);
      try {
        let report: Awaited<ReturnType<AudioAnalyzer['analyze']>> | null = null;
        if (query.type === 'music') {
          try {
            report = await audio.analyze(storage.resolve(key));
          } catch (error) {
            if (!(error instanceof AudioAnalysisError)) throw error;
            throw new HttpError(
              422,
              'INVALID_AUDIO',
              `The audio could not be decoded: ${error.message}`,
            );
          }
          if (
            report.durationSeconds < MUSIC_MIN_SECONDS ||
            report.durationSeconds > MUSIC_MAX_SECONDS
          ) {
            throw new HttpError(
              422,
              'INVALID_AUDIO_LENGTH',
              `Tracks must be between ${formatSeconds(MUSIC_MIN_SECONDS)} and ${formatSeconds(MUSIC_MAX_SECONDS)}; this one is ${formatSeconds(Math.round(report.durationSeconds))}`,
            );
          }
          if (report.integratedLufs === null) {
            throw new HttpError(422, 'SILENT_AUDIO', 'The track is silent');
          }
        }
        const size = sniffed.mimeType === 'image/png' ? pngSize(data) : null;
        const { rows } = await pool.query<MediaRow>(
          `INSERT INTO media_assets (id, type, name, storage_key, mime_type, file_format, size_bytes,
             checksum_sha256, duration_seconds, width, height, category, audio, license_type,
             license, commercial_use, attribution_required, attribution, license_reference,
             uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING *`,
          [
            id,
            query.type,
            query.name ?? sanitizeFilename(query.filename),
            key,
            sniffed.mimeType,
            sniffed.extension,
            data.length,
            createHash('sha256').update(data).digest('hex'),
            report?.durationSeconds ??
              (sniffed.mimeType === 'audio/wav' ? wavDuration(data) : null),
            size?.width ?? null,
            size?.height ?? null,
            query.type === 'music' ? (query.category ?? null) : null,
            report
              ? JSON.stringify({
                  codec: report.codec,
                  sampleRate: report.sampleRate,
                  channels: report.channels,
                  truePeakDbtp: report.truePeakDbtp,
                  integratedLufs: report.integratedLufs,
                } satisfies AudioAnalysis)
              : null,
            query.licenseType ?? null,
            query.license ?? null,
            query.commercialUse ?? null,
            query.attributionRequired ?? false,
            query.attribution ?? null,
            query.licenseReference ?? null,
            currentUser(res).id,
          ],
        );
        res.status(201).json(toAsset(rows[0]!));
      } catch (error) {
        await storage.remove(key);
        throw error;
      }
    },
  );

  return router;
}
