import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MediaAssetType, OutputFormat, RenderKind } from '@statsopedia/shared-types';

/** Every directory under the storage root. Created on service start-up if missing. */
export const STORAGE_DIRECTORIES = [
  'datasets',
  'processed',
  'assets/logos',
  'assets/music',
  'assets/fonts',
  'assets/images',
  'renders/previews',
  'renders/long',
  'renders/shorts',
  'thumbnails',
  'logs',
  'temp',
] as const;
export type StorageDirectory = (typeof STORAGE_DIRECTORIES)[number];

export class StoragePathError extends Error {
  override name = 'StoragePathError';
}

/**
 * Joins a storage-relative path onto the storage root, refusing anything that would escape it
 * (absolute paths, `..` traversal). Use this for every path that originates outside the process.
 */
export function resolveStoragePath(storageRoot: string, relativePath: string): string {
  if (!path.isAbsolute(storageRoot)) {
    throw new StoragePathError(`Storage root must be an absolute path, got "${storageRoot}"`);
  }
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new StoragePathError(`Expected a storage-relative path, got "${relativePath}"`);
  }
  const resolved = path.resolve(storageRoot, relativePath);
  const relative = path.relative(storageRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new StoragePathError(`Path "${relativePath}" escapes the storage root`);
  }
  return resolved;
}

/** Creates any missing storage directories. Idempotent. */
export async function ensureStorageDirectories(storageRoot: string): Promise<void> {
  await Promise.all(
    STORAGE_DIRECTORIES.map((directory) =>
      mkdir(path.join(storageRoot, directory), { recursive: true }),
    ),
  );
}

/** Directory that a render of the given kind and format is written to. */
export function renderOutputDirectory(kind: RenderKind, format: OutputFormat): StorageDirectory {
  if (kind === 'preview') return 'renders/previews';
  return format === 'long' ? 'renders/long' : 'renders/shorts';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: string): string {
  if (!UUID.test(value))
    throw new StoragePathError(`Storage keys are built from UUIDs, got "${value}"`);
  return value.toLowerCase();
}

const ASSET_DIRECTORIES: Record<MediaAssetType, StorageDirectory> = {
  logo: 'assets/logos',
  music: 'assets/music',
  font: 'assets/fonts',
  image: 'assets/images',
  thumbnail: 'thumbnails',
};

/**
 * The only place storage keys are made. Keys are relative to the storage root, built from
 * server-generated UUIDs (never client input) and stored in the database as-is.
 */
export const storageKeys = {
  datasetSource: (datasetId: string, versionId: string) =>
    `datasets/${id(datasetId)}/${id(versionId)}.csv`,
  datasetNormalized: (datasetId: string, versionId: string) =>
    `processed/${id(datasetId)}/${id(versionId)}.json`,
  datasetReport: (datasetId: string, versionId: string) =>
    `processed/${id(datasetId)}/${id(versionId)}.report.json`,
  validationUpload: (uploadId: string) => `temp/validate-${id(uploadId)}.csv`,
  mediaAsset: (type: MediaAssetType, assetId: string, extension: string) => {
    if (!/^[a-z0-9]{1,5}$/.test(extension))
      throw new StoragePathError(`Bad extension "${extension}"`);
    return `${ASSET_DIRECTORIES[type]}/${id(assetId)}.${extension}`;
  },
  /** `renders/long/<projectId>_long_v3.mp4`; previews get a `_preview` suffix. */
  renderOutput: (render: RenderName) =>
    `${renderOutputDirectory(render.kind, render.format)}/${renderBaseName(render)}.mp4`,
  thumbnail: (render: RenderName) => `thumbnails/${renderBaseName(render)}.jpg`,
  /** Render log of every attempt (NDJSON), next to nothing a client can reach. */
  renderLog: (render: RenderName) => `logs/${renderBaseName(render)}.log`,
  /** Private working directory of one render job; removed after every attempt. */
  renderTempDirectory: (renderJobId: string) => `temp/renders/${id(renderJobId)}`,
};

/** What identifies a rendered file: never a user-supplied title. */
export interface RenderName {
  projectId: string;
  kind: RenderKind;
  format: OutputFormat;
  /** Per-project render number, so re-renders never reuse a name. */
  renderVersion: number;
}

function renderBaseName({ projectId, kind, format, renderVersion }: RenderName): string {
  if (!Number.isSafeInteger(renderVersion) || renderVersion < 1) {
    throw new StoragePathError(`Render version must be a positive integer, got ${renderVersion}`);
  }
  if (format !== 'long' && format !== 'short')
    throw new StoragePathError(`Bad format "${String(format)}"`);
  return `${id(projectId)}_${format}_v${renderVersion}${kind === 'preview' ? '_preview' : ''}`;
}

/**
 * Local-filesystem storage. Every method takes a storage key, resolves it under the root and
 * refuses keys that would escape it, so callers never handle absolute paths.
 */
export class LocalStorage {
  constructor(readonly root: string) {
    if (!path.isAbsolute(root)) throw new StoragePathError('Storage root must be absolute');
  }

  /** Absolute path, for handing to tools that need one (Remotion, ffprobe). Never send it to clients. */
  resolve(key: string): string {
    return resolveStoragePath(this.root, key);
  }

  /** Writes a new file; fails if the key already exists. Files are never executable. */
  async writeNew(key: string, data: Buffer | string): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx', mode: 0o640 });
  }

  /** Writes via a temporary file and rename, so readers never see a partial file. */
  async writeAtomic(key: string, data: Buffer | string): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { mode: 0o640 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async readJson(key: string): Promise<unknown> {
    return JSON.parse(await readFile(this.resolve(key), 'utf8'));
  }

  createReadStream(key: string, options?: { start?: number; end?: number }): ReadStream {
    return createReadStream(this.resolve(key), options);
  }

  /** Size in bytes, or null when the file does not exist. */
  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.resolve(key))).size;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Streams the file, so large videos are never held in memory. */
  async sha256(key: string): Promise<string> {
    return sha256File(this.resolve(key));
  }
}

/** SHA-256 of a file, read as a stream. */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
