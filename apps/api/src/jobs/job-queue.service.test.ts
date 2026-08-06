import { describe, expect, it } from 'vitest';

import { createJobId } from './job-queue.service.js';

describe('createJobId', () => {
  it('creates a stable queue-safe identifier from the command idempotency scope', () => {
    const first = createJobId('notification.dispatch', 'invoice:123:overdue');
    const replay = createJobId('notification.dispatch', 'invoice:123:overdue');
    const differentJob = createJobId('report.generate', 'invoice:123:overdue');

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(replay).toBe(first);
    expect(differentJob).not.toBe(first);
  });
});
