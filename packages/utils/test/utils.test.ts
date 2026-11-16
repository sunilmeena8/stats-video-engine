import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { canonicalJson, clamp, formatCompactNumber, formatDuration, lerp } from '../src/index.js';
import {
  ConfigError,
  STORAGE_DIRECTORIES,
  StoragePathError,
  ensureStorageDirectories,
  parseEnv,
  renderOutputDirectory,
  resolveStoragePath,
} from '../src/node/index.js';

describe('number helpers', () => {
  it('clamps and interpolates', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(lerp(0, 100, 0.25)).toBe(25);
  });

  it('formats compact numbers and durations', () => {
    expect(formatCompactNumber(1_234_567)).toBe('1.2M');
    expect(formatCompactNumber(950)).toBe('950');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(3_725)).toBe('1h 2m 5s');
  });
});

describe('storage', () => {
  const root = path.resolve('/srv/statsopedia/storage');

  it('resolves paths inside the storage root', () => {
    expect(resolveStoragePath(root, 'datasets/gdp.csv')).toBe(path.join(root, 'datasets/gdp.csv'));
  });

  it.each(['../outside.txt', 'datasets/../../outside', '/etc/passwd', '', '.'])(
    'refuses %j',
    (relative) => {
      expect(() => resolveStoragePath(root, relative)).toThrow(StoragePathError);
    },
  );

  it('maps render kinds and formats to directories', () => {
    expect(renderOutputDirectory('preview', 'short')).toBe('renders/previews');
    expect(renderOutputDirectory('final', 'long')).toBe('renders/long');
    expect(renderOutputDirectory('final', 'short')).toBe('renders/shorts');
  });

  describe('ensureStorageDirectories', () => {
    let tempRoot: string | undefined;
    afterEach(async () => {
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    });

    it('creates the full directory skeleton', async () => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), 'statsopedia-storage-'));
      await ensureStorageDirectories(tempRoot);
      for (const directory of STORAGE_DIRECTORIES) {
        const info = await stat(path.join(tempRoot, directory));
        expect(info.isDirectory()).toBe(true);
      }
    });
  });
});

describe('parseEnv', () => {
  const schema = z.object({
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.url(),
  });

  it('applies defaults for unset and empty values', () => {
    expect(parseEnv(schema, { PORT: '', DATABASE_URL: 'postgres://localhost/db' })).toEqual({
      PORT: 4000,
      DATABASE_URL: 'postgres://localhost/db',
    });
  });

  it('throws a ConfigError naming the invalid variable', () => {
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(ConfigError);
    expect(() => parseEnv(schema, { PORT: 'abc' })).toThrow(/DATABASE_URL/);
  });
});

describe('canonicalJson', () => {
  it('serializes equal values identically regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});
