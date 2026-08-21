import { describe, expect, it } from 'vitest';

import { agingBucket } from './finance-reports.service.js';

describe('Finance report aging buckets', () => {
  it('uses the required inclusive aging boundaries', () => {
    expect(agingBucket(0)).toBe('current');
    expect(agingBucket(1)).toBe('days_0_30');
    expect(agingBucket(30)).toBe('days_0_30');
    expect(agingBucket(31)).toBe('days_31_60');
    expect(agingBucket(60)).toBe('days_31_60');
    expect(agingBucket(61)).toBe('days_61_90');
    expect(agingBucket(90)).toBe('days_61_90');
    expect(agingBucket(91)).toBe('over_90');
  });
});
