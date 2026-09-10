import { describe, expect, it } from 'vitest';
import { posReportTimestamp } from './pos-reports.service.js';

describe('POS export business timestamps', () => {
  it.each([
    ['2026-01-15T10:00:00Z', 'Europe/Sofia', '2026-01-15 12:00:00'],
    ['2026-07-15T10:00:00Z', 'Europe/Sofia', '2026-07-15 13:00:00'],
    ['2026-01-15T22:30:12Z', 'Europe/Sofia', '2026-01-16 00:30:12'],
    ['2026-01-15T10:00:00Z', 'UTC', '2026-01-15 10:00:00'],
  ])('formats %s in %s', (value, zone, expected) => {
    expect(posReportTimestamp(value, zone)).toBe(expected);
  });
});
