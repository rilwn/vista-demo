import { describe, expect, it } from 'vitest';

import { addBusinessMinutes, businessTimerState } from './crm-sla-clock.js';

describe('CRM SLA business clock', () => {
  it('pauses outside Sofia business hours and over weekends', () => {
    // Friday 16:00 in Sofia. One hour expires Friday; the remaining three
    // business hours expire Monday morning.
    expect(addBusinessMinutes('2026-10-16T13:00:00.000Z', 240, 'Europe/Sofia').toISOString()).toBe(
      '2026-10-19T09:00:00.000Z',
    );
  });

  it('marks the timer at risk only after the configured business-time threshold', () => {
    const createdAt = '2026-10-13T07:00:00.000Z'; // 10:00 Tuesday in Sofia
    expect(
      businessTimerState({
        completedAt: null,
        createdAt,
        dueAt: '2026-10-13T11:00:00.000Z',
        minutes: 240,
        now: new Date('2026-10-13T09:59:00.000Z'),
        thresholdPercent: 75,
        timezone: 'Europe/Sofia',
      }),
    ).toBe('on_track');
    expect(
      businessTimerState({
        completedAt: null,
        createdAt,
        dueAt: '2026-10-13T11:00:00.000Z',
        minutes: 240,
        now: new Date('2026-10-13T10:00:00.000Z'),
        thresholdPercent: 75,
        timezone: 'Europe/Sofia',
      }),
    ).toBe('at_risk');
  });
});
