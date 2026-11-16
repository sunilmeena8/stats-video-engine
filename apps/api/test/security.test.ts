import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { rateLimit } from '../src/http/rate-limit.js';
import { sniffMedia } from '../src/media/media.js';

describe('password hashing', () => {
  it('hashes with a random salt and verifies in constant time', async () => {
    const first = await hashPassword('a long enough passphrase');
    const second = await hashPassword('a long enough passphrase');
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('a long enough passphrase', first)).toBe(true);
    expect(await verifyPassword('a long enough passphrasE', first)).toBe(false);
    expect(await verifyPassword('anything', 'plaintext')).toBe(false);
    expect(first).not.toContain('passphrase');
  });
});

describe('rateLimit', () => {
  it('allows max requests per window, then answers 429 with Retry-After', async () => {
    let now = 0;
    const app = express();
    app.get(
      '/',
      rateLimit({ name: 't', windowMs: 1_000, max: 2, key: () => 'k', now: () => now }),
      (_req, res) => {
        res.send('ok');
      },
    );
    app.use(errorHandler);
    await request(app).get('/').expect(200);
    await request(app).get('/').expect(200);
    const limited = await request(app).get('/').expect(429);
    expect(limited.headers['retry-after']).toBe('1');
    now = 1_001;
    await request(app).get('/').expect(200);
  });
});

describe('sniffMedia', () => {
  it('identifies uploads by their bytes, not their names', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    expect(sniffMedia(wav)?.mimeType).toBe('audio/wav');
    expect(sniffMedia(Buffer.from('ID3\u0004rest'))?.mimeType).toBe('audio/mpeg');
    expect(
      sniffMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.extension,
    ).toBe('png');
    expect(sniffMedia(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(sniffMedia(Buffer.from('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(sniffMedia(Buffer.from('MZ\u0090\u0000'))).toBeNull();
  });
});
