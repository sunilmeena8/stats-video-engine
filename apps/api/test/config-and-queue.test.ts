import path from 'node:path';

import { ConfigError } from '@statsopedia/utils/node';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const validEnv = {
  DATABASE_URL: 'postgres://user:secret@127.0.0.1:5432/statsopedia',
  REDIS_URL: 'redis://:secret@127.0.0.1:6379',
};

describe('loadConfig', () => {
  it('applies defaults and resolves the storage root to an absolute path', () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
    });
    expect(path.isAbsolute(config.STORAGE_ROOT)).toBe(true);
  });

  it('requires connection URLs (no hardcoded credential fallbacks)', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/,
    );
  });

  it('rejects URLs with the wrong protocol and invalid ports', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://x@y/z' })).toThrow(
      /postgres:\/\//,
    );
    expect(() => loadConfig({ ...validEnv, API_PORT: '70000' })).toThrow(ConfigError);
  });
});

describe('loadConfig security settings', () => {
  it('has bounded limits and enables the job monitor by default', () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      SESSION_TTL_HOURS: 12,
      RATE_LIMIT_PER_MINUTE: 600,
      MAX_MEDIA_BYTES: 25 * 1024 * 1024,
      JOB_MONITOR_ENABLED: true,
    });
    expect(loadConfig({ ...validEnv, JOB_MONITOR_ENABLED: 'false' }).JOB_MONITOR_ENABLED).toBe(
      false,
    );
    expect(() => loadConfig({ ...validEnv, SESSION_TTL_HOURS: '0' })).toThrow(ConfigError);
  });
});
