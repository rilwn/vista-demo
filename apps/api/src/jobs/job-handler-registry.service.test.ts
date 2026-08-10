import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { type BackgroundJobContext, JobHandlerRegistry } from './job-handler-registry.service.js';

const context: BackgroundJobContext = {
  attemptNumber: 1,
  correlationId: 'correlation-1',
  enqueuedAt: '2026-08-10T08:00:00.000Z',
  idempotencyKey: 'run-1',
  jobId: 'job-1',
  maxAttempts: 5,
  name: 'report.generate',
  payload: { reportId: 'report-1' },
  retryAllowed: true,
};

describe('JobHandlerRegistry', () => {
  it('routes a job to its single registered handler', async () => {
    const registry = new JobHandlerRegistry();
    const handle = vi.fn().mockResolvedValue({ accepted: true });
    registry.register('report.generate', { handle });

    await expect(registry.execute(context)).resolves.toEqual({ accepted: true });
    expect(handle).toHaveBeenCalledWith(context);
    expect(registry.registeredNames()).toEqual(['report.generate']);
  });

  it('rejects duplicate and invalid registrations', () => {
    const registry = new JobHandlerRegistry();
    registry.register('report.generate', { handle: vi.fn() });

    expect(() => registry.register('report.generate', { handle: vi.fn() })).toThrow(
      'already registered',
    );
    expect(() => registry.register('Report Generate', { handle: vi.fn() })).toThrow(
      'stable lowercase dotted identifier',
    );
  });

  it('fails an unknown job without consuming retry attempts', async () => {
    const registry = new JobHandlerRegistry();

    await expect(registry.execute(context)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
