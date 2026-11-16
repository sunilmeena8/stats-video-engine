import type { Timestamps, Uuid } from './common.js';

export const MEDIA_ASSET_TYPES = ['logo', 'music', 'font', 'image', 'thumbnail'] as const;
export type MediaAssetType = (typeof MEDIA_ASSET_TYPES)[number];

/** Mood categories of the music library. */
export const MUSIC_CATEGORIES = [
  'corporate',
  'cinematic',
  'technology',
  'energetic',
  'ambient',
  'documentary',
] as const;
export type MusicCategory = (typeof MUSIC_CATEGORIES)[number];

/**
 * How a file may be used. `royalty_free` and `commercial` are paid or granted licenses;
 * `creative_commons` covers the CC family (the exact one goes in `license`).
 */
export const LICENSE_TYPES = [
  'royalty_free',
  'creative_commons',
  'public_domain',
  'commercial',
  'original',
  'other',
] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

/** Measured from the decoded audio when a track is uploaded. */
export interface AudioAnalysis {
  /** e.g. `mp3`, `pcm_s16le`, `aac`, `vorbis`. */
  codec: string;
  sampleRate: number;
  channels: number;
  /** True peak in dBTP (0 = full scale; inter-sample peaks included). Null when silent. */
  truePeakDbtp: number | null;
  /** Integrated loudness (EBU R128), in LUFS. Null when the track is silent. */
  integratedLufs: number | null;
}

/** A file used by or produced for videos. Served through `downloadUrl`, never by path. */
export interface MediaAsset extends Timestamps {
  id: Uuid;
  type: MediaAssetType;
  name: string;
  mimeType: string;
  /** File format from the file's own bytes: `mp3`, `wav`, `ogg`, `m4a`, `png`… */
  fileFormat: string;
  fileSizeBytes: number;
  checksumSha256: string;
  /** For audio assets. */
  durationSeconds: number | null;
  /** For image assets. */
  width: number | null;
  height: number | null;
  /** Music only. */
  category: MusicCategory | null;
  /** Music only: measured at upload. */
  audio: AudioAnalysis | null;
  licenseType: LicenseType | null;
  /** License name or version, e.g. `CC BY 4.0` or `Artlist Pro`. */
  license: string | null;
  /** May the file be used in monetized (commercial) videos? Null = not recorded. */
  commercialUse: boolean | null;
  /** Must the video credit the author? */
  attributionRequired: boolean;
  /** The exact credit line the license asks for. Required when attributionRequired. */
  attribution: string | null;
  /** Where the license is documented: a URL, invoice or agreement reference. */
  licenseReference: string | null;
  /** When the file was uploaded (same as createdAt). */
  uploadedAt: string;
  downloadUrl: string;
}

/** Body of `PATCH /api/media/:id`: corrects names and licensing metadata, never the file. */
export interface UpdateMediaRequest {
  name?: string;
  category?: MusicCategory | null;
  licenseType?: LicenseType | null;
  license?: string | null;
  commercialUse?: boolean | null;
  attributionRequired?: boolean;
  attribution?: string | null;
  licenseReference?: string | null;
}

/**
 * Licensing of the music a render used, copied when the render was submitted so later edits
 * to the asset never change what a finished video recorded.
 */
export interface MusicLicenseSnapshot {
  assetId: Uuid;
  name: string;
  checksumSha256: string;
  licenseType: LicenseType | null;
  license: string | null;
  commercialUse: boolean | null;
  attributionRequired: boolean;
  attribution: string | null;
  licenseReference: string | null;
}
