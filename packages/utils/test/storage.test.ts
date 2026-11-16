import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStorage, StoragePathError, storageKeys } from '../src/node/index.js';

const A = '0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d';
const B = '7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c';

describe('storageKeys', () => {
  it('builds keys from UUIDs only', () => {
    expect(storageKeys.datasetSource(A, B)).toBe(`datasets/${A}/${B}.csv`);
    const render = { projectId: A, kind: 'final', format: 'short', renderVersion: 3 } as const;
    expect(storageKeys.renderOutput(render)).toBe(`renders/shorts/${A}_short_v3.mp4`);
    expect(storageKeys.renderOutput({ ...render, format: 'long' })).toBe(
      `renders/long/${A}_long_v3.mp4`,
    );
    expect(storageKeys.renderOutput({ ...render, kind: 'preview' })).toBe(
      `renders/previews/${A}_short_v3_preview.mp4`,
    );
    expect(storageKeys.thumbnail(render)).toBe(`thumbnails/${A}_short_v3.jpg`);
    expect(storageKeys.renderLog(render)).toBe(`logs/${A}_short_v3.log`);
    expect(storageKeys.renderTempDirectory(A)).toBe(`temp/renders/${A}`);
    expect(() => storageKeys.renderOutput({ ...render, renderVersion: 0 })).toThrow();
    expect(() => storageKeys.renderOutput({ ...render, projectId: 'Big Title' })).toThrow();
    expect(storageKeys.mediaAsset('music', A, 'mp3')).toBe(`assets/music/${A}.mp3`);
    expect(() => storageKeys.datasetSource('../etc', B)).toThrow(StoragePathError);
    expect(() => storageKeys.mediaAsset('music', A, 'mp3/../x')).toThrow(StoragePathError);
  });
});

describe('LocalStorage', () => {
  let root: string;
  let storage: LocalStorage;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'statsopedia-storage-'));
    storage = new LocalStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('writes new files once, replaces atomically and reports sizes', async () => {
    await storage.writeNew('temp/a.txt', 'one');
    await expect(storage.writeNew('temp/a.txt', 'two')).rejects.toThrow();
    await storage.writeAtomic('temp/a.txt', 'three');
    expect((await storage.read('temp/a.txt')).toString()).toBe('three');
    expect(await storage.size('temp/a.txt')).toBe(5);
    expect(await storage.size('temp/missing.txt')).toBeNull();
    expect(await readdir(path.join(root, 'temp'))).toEqual(['a.txt']); // no leftover temp files
    await storage.remove('temp/a.txt');
    expect(await storage.size('temp/a.txt')).toBeNull();
  });

  it('refuses keys that escape the root', async () => {
    await expect(storage.read('../outside.txt')).rejects.toThrow(StoragePathError);
    expect(() => storage.resolve('/etc/passwd')).toThrow(StoragePathError);
  });
});
