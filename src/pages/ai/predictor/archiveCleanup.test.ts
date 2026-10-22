import { describe, expect, it } from 'vitest';
import { formatBytes, optionalCount } from './ArchiveCleanup';

describe('archive clean-up fields', () => {
  it('treats an empty field as not set and rejects invalid counts', () => {
    expect(optionalCount('')).toBeNull();
    expect(optionalCount('3')).toBe(3);
    expect(optionalCount('-1')).toBeNaN();
    expect(optionalCount('1.5')).toBeNaN();
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
  });
});
