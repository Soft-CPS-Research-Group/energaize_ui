import { describe, expect, it } from 'vitest';
import { batchCountsText, batchPercent, countByReason, currentBatch } from './batchFormat';
import type { BatchSummary } from '../../../api/predictorApi';

const summary = (id: string, status: BatchSummary['status']): BatchSummary => ({
  batch_id: id, status, created_at: '2026-10-22T10:00:00Z', finished_at: null, message: '',
  options: {}, total: 4, finished: 1, counts: {},
});

describe('countByReason', () => {
  it('counts lanes per reason, most urgent first, without empty groups', () => {
    expect(countByReason([{ priority: 3 }, { priority: 0 }, { priority: 3 }])).toEqual([
      { priority: 0, label: 'Forecast refused', count: 1 },
      { priority: 3, label: 'Old model', count: 2 },
    ]);
  });
});

describe('batch progress', () => {
  it('is the share of finished lanes', () => {
    expect(batchPercent({ finished: 1, total: 4 })).toBe(25);
    expect(batchPercent({ finished: 0, total: 0 })).toBe(0);
  });

  it('lists results in a fixed order with one-word labels', () => {
    expect(batchCountsText({ FAILED: 1, ACCEPTED: 3, QUEUED: 2, REJECTED: 1 })).toBe('3 accepted · 1 rejected · 1 failed');
  });
});

describe('currentBatch', () => {
  it('prefers the running batch, else the newest', () => {
    expect(currentBatch([summary('a', 'DONE'), summary('b', 'RUNNING')])?.batch_id).toBe('b');
    expect(currentBatch([summary('a', 'DONE'), summary('b', 'CANCELED')])?.batch_id).toBe('a');
    expect(currentBatch([])).toBeNull();
  });
});
