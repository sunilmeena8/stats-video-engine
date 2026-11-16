import {
  appendFile,
  copyFile,
  constants,
  link,
  mkdir,
  readdir,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import { storageKeys, type LocalStorage } from '@statsopedia/utils/node';

import { permanentError } from './errors.js';

const errorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';

/**
 * A private working directory for one render job, emptied first: whatever a crashed or
 * cancelled earlier attempt left behind is removed before the new attempt starts. Only the
 * worker holding the job's queue lock touches it.
 */
export async function prepareTempDirectory(storage: LocalStorage, renderJobId: string) {
  const directory = storage.resolve(storageKeys.renderTempDirectory(renderJobId));
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o750 });
  return {
    directory,
    file: (name: string) => path.join(directory, name),
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

/**
 * Removes job working directories older than `maxAgeMs` (left by a worker that was killed).
 * Directories of running jobs are younger than the job timeout, so they are never touched.
 */
export async function sweepTempDirectories(
  storage: LocalStorage,
  maxAgeMs: number,
  now = Date.now(),
): Promise<number> {
  const root = storage.resolve('temp/renders');
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    const directory = path.join(root, entry);
    try {
      if (now - (await stat(directory)).mtimeMs > maxAgeMs) {
        await rm(directory, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Removed concurrently: nothing to do.
    }
  }
  return removed;
}

/**
 * Moves a finished file from the job's temp directory to its storage key, atomically and
 * without ever replacing an existing file: `link` fails if the target exists, and readers see
 * either no file or the complete one. Falls back to an exclusive copy across filesystems.
 */
export async function publishFile(
  storage: LocalStorage,
  source: string,
  key: string,
): Promise<void> {
  const target = storage.resolve(key);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await link(source, target);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw permanentError('OUTPUT_EXISTS', `Refusing to overwrite an existing file (${key})`);
    }
    if (errorCode(error) !== 'EXDEV') throw error;
    await copyFile(source, target, constants.COPYFILE_EXCL);
  }
  await unlink(source).catch(() => undefined);
}

/** Appends one JSON line per entry to the job's render log under `storage/logs/`. */
export function createJobLog(storage: LocalStorage, key: string) {
  const file = storage.resolve(key);
  let ready: Promise<unknown> | undefined;
  return async (entry: Record<string, unknown>) => {
    ready ??= mkdir(path.dirname(file), { recursive: true });
    await ready;
    await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, {
      mode: 0o640,
    });
  };
}
