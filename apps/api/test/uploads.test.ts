import { describe, expect, it } from 'vitest';

import { slugify } from '../src/datasets/service.js';
import { checkCsvUpload, sanitizeFilename } from '../src/datasets/uploads.js';
import { HttpError } from '../src/errors.js';

describe('sanitizeFilename', () => {
  it.each([
    ['gdp.csv', 'gdp.csv'],
    ['../../etc/passwd.csv', 'passwd.csv'],
    ['C:\\Users\\me\\data.csv', 'data.csv'],
    ['  ..hidden.csv  ', 'hidden.csv'],
    ['naïve résumé (v2).csv', 'naïve résumé (v2).csv'],
    ['a<b>c|d:e*f?.csv', 'a_b_c_d_e_f_.csv'],
    ['line\nbreak\u0000.csv', 'linebreak.csv'],
    ['$(rm -rf).csv', '_(rm -rf).csv'],
    ['', 'upload.csv'],
    [undefined, 'upload.csv'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('caps the length but keeps the extension', () => {
    const name = sanitizeFilename(`${'x'.repeat(500)}.csv`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.csv')).toBe(true);
  });
});

describe('checkCsvUpload', () => {
  const csv = Buffer.from('entity_id,entity_name,year,value,unit,source_id\n');

  function rejection(body: unknown, filename: string | undefined) {
    try {
      checkCsvUpload(body, filename);
    } catch (error) {
      return error instanceof HttpError ? [error.status, error.code] : error;
    }
    return 'accepted';
  }

  it('accepts a CSV buffer and sanitizes its name', () => {
    expect(checkCsvUpload(csv, '../x/data.csv')).toEqual({ data: csv, filename: 'data.csv' });
  });

  it('rejects non-CSV names, missing bodies, empty and binary files', () => {
    expect(rejection(csv, 'data.xlsx')).toEqual([415, 'INVALID_FILE_TYPE']);
    expect(rejection(csv, 'data.csv.exe')).toEqual([415, 'INVALID_FILE_TYPE']);
    expect(rejection({}, 'data.csv')).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    expect(rejection(Buffer.alloc(0), 'data.csv')).toEqual([400, 'EMPTY_FILE']);
    expect(rejection(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), 'data.csv')).toEqual([
      415,
      'INVALID_FILE_TYPE',
    ]);
  });
});

describe('slugify', () => {
  it.each([
    ['GDP by Country', 'gdp-by-country'],
    ['Café São Paulo (2024)!', 'cafe-sao-paulo-2024'],
    ['日本', 'dataset'],
  ])('%j → %j', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });
});
