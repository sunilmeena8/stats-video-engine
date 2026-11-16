import {
  LICENSE_TYPES,
  MEDIA_ASSET_TYPES,
  MUSIC_CATEGORIES,
  type AudioAnalysis,
  type MediaAsset,
  type MusicLicenseSnapshot,
  type UpdateMediaRequest,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { isoDateTimeSchema, sha256Schema, timestampsShape, uuidSchema } from './primitives.js';

export const mediaAssetTypeSchema = z.enum(MEDIA_ASSET_TYPES);
export const musicCategorySchema = z.enum(MUSIC_CATEGORIES);
export const licenseTypeSchema = z.enum(LICENSE_TYPES);

/** Shortest and longest music track the library accepts. */
export const MUSIC_MIN_SECONDS = 5;
export const MUSIC_MAX_SECONDS = 30 * 60;

export const audioAnalysisSchema = z.object({
  codec: z.string().min(1).max(40),
  sampleRate: z.int().positive(),
  channels: z.int().positive(),
  truePeakDbtp: z.number().max(12).nullable(),
  integratedLufs: z.number().nullable(),
}) satisfies z.ZodType<AudioAnalysis>;

const licenseShape = {
  licenseType: licenseTypeSchema.nullable(),
  license: z.string().trim().max(200).nullable(),
  commercialUse: z.boolean().nullable(),
  attributionRequired: z.boolean(),
  attribution: z.string().trim().max(300).nullable(),
  licenseReference: z.string().trim().max(1_000).nullable(),
};

export const mediaAssetSchema = z.object({
  id: uuidSchema,
  type: mediaAssetTypeSchema,
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, 'Must be a MIME type such as audio/mpeg'),
  fileFormat: z.string().min(1).max(20),
  fileSizeBytes: z.int().nonnegative(),
  checksumSha256: sha256Schema,
  durationSeconds: z.number().positive().nullable(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  category: musicCategorySchema.nullable(),
  audio: audioAnalysisSchema.nullable(),
  ...licenseShape,
  // Older rows may carry longer free-text attributions.
  attribution: z.string().max(1_000).nullable(),
  uploadedAt: isoDateTimeSchema,
  downloadUrl: z.string().startsWith('/api/'),
  ...timestampsShape,
}) satisfies z.ZodType<MediaAsset>;

const attributionTextRequired = {
  message: 'Enter the credit line the license requires',
  path: ['attribution'],
};

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Query string of `POST /api/media` (the file is the raw request body). Music must have a
 * category and its licensing recorded; a license that requires attribution must say how.
 */
export const mediaUploadQuerySchema = z
  .object({
    type: mediaAssetTypeSchema,
    filename: z.string().min(1).max(1_000),
    name: z.string().trim().min(1).max(200).optional(),
    category: musicCategorySchema.optional(),
    licenseType: licenseTypeSchema.optional(),
    license: z.string().trim().max(200).optional(),
    commercialUse: booleanQuery.optional(),
    attributionRequired: booleanQuery.optional(),
    attribution: z.string().trim().max(300).optional(),
    licenseReference: z.string().trim().max(1_000).optional(),
  })
  .strict()
  .refine((query) => query.type !== 'music' || query.category !== undefined, {
    message: 'Choose a category for the track',
    path: ['category'],
  })
  .refine((query) => query.type !== 'music' || query.licenseType !== undefined, {
    message: 'Record the license type of the track',
    path: ['licenseType'],
  })
  .refine((query) => query.type !== 'music' || query.commercialUse !== undefined, {
    message: 'Say whether the license allows commercial use',
    path: ['commercialUse'],
  })
  .refine((query) => !query.attributionRequired || !!query.attribution, attributionTextRequired);

/** Body of `PATCH /api/media/:id`. The merged result is checked like an upload. */
export const updateMediaRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    category: musicCategorySchema.nullable().optional(),
    licenseType: licenseShape.licenseType.optional(),
    license: licenseShape.license.optional(),
    commercialUse: licenseShape.commercialUse.optional(),
    attributionRequired: licenseShape.attributionRequired.optional(),
    attribution: licenseShape.attribution.optional(),
    licenseReference: licenseShape.licenseReference.optional(),
  })
  .strict() satisfies z.ZodType<UpdateMediaRequest>;

export const musicLicenseSnapshotSchema = z.object({
  assetId: uuidSchema,
  name: z.string().min(1).max(200),
  checksumSha256: sha256Schema,
  ...licenseShape,
  attribution: z.string().max(1_000).nullable(),
}) satisfies z.ZodType<MusicLicenseSnapshot>;
