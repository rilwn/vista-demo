import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsController } from './jobs.controller.js';
import type { JobQueueService } from './job-queue.service.js';

const snapshot = {
  active: 2,
  completed: 9,
  delayed: 3,
  failed: 1,
  waiting: 4,
  paused: false,
  timestamp: '2026-09-09T12:00:00Z',
};
const create = (getTelemetry: () => Promise<typeof snapshot>) =>
  new JobsController({ getTelemetry } as unknown as JobQueueService);
afterEach(() => vi.useRealTimers());
describe('job monitoring', () => {
  it('exports fixed low-cardinality gauges without payloads', async () => {
    const controller = create(() => Promise.resolve({ ...snapshot, payload: 'private data' }));
    const text = await controller.prometheus();
    expect(text).toContain('vista_jobs{state="waiting"} 4\n');
    expect(text).toContain('# TYPE vista_jobs gauge');
    expect(text).toContain('vista_jobs_paused 0\n');
    expect(text).not.toContain('private data');
  });
  it('sanitizes dependency failure and recovers on the next check', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(Error('redis://secret@host'))
      .mockResolvedValue(snapshot);
    const controller = create(get);
    await expect(controller.metrics()).rejects.toMatchObject({
      response: { code: 'JOB_MONITORING_UNAVAILABLE' },
    });
    expect(await controller.metrics()).toEqual(snapshot);
  });
  it('bounds an unresponsive queue check', async () => {
    vi.useFakeTimers();
    const controller = create(() => new Promise(() => {}));
    const assertion = expect(controller.metrics()).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});
