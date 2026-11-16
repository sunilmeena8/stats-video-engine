import type { RenderJobStatus } from '@statsopedia/shared-types';
import { describe, expect, it } from 'vitest';

import { aggregateJobs, requestTypeFor } from '../src/index.js';

const job = (status: RenderJobStatus, percent = 0) => ({ status, percent });

describe('requestTypeFor', () => {
  it('names submissions the way the product does', () => {
    expect(requestTypeFor('preview', ['short'])).toBe('preview');
    expect(requestTypeFor('final', ['long'])).toBe('long_form');
    expect(requestTypeFor('final', ['short'])).toBe('short');
    expect(requestTypeFor('final', ['long', 'short'])).toBe('both');
  });
});

describe('aggregateJobs', () => {
  it('averages progress, counting finished jobs as done', () => {
    expect(aggregateJobs([job('pending'), job('pending')])).toEqual({
      status: 'pending',
      percent: 0,
    });
    expect(aggregateJobs([job('rendering', 40), job('pending')])).toEqual({
      status: 'in_progress',
      percent: 20,
    });
    expect(aggregateJobs([job('completed', 100), job('rendering', 50)])).toEqual({
      status: 'in_progress',
      percent: 75,
    });
  });

  it('tracks each output of a "both" request independently', () => {
    expect(aggregateJobs([job('completed', 100), job('completed', 100)]).status).toBe('completed');
    expect(aggregateJobs([job('completed', 100), job('failed', 30)]).status).toBe('partial');
    expect(aggregateJobs([job('completed', 100), job('cancelled', 10)]).status).toBe('partial');
    expect(aggregateJobs([job('failed', 10), job('cancelled', 10)]).status).toBe('failed');
    expect(aggregateJobs([job('cancelled'), job('cancelled')]).status).toBe('cancelled');
  });
});
