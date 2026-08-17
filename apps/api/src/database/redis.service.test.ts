import { describe, expect, it } from 'vitest';

import { RedisService } from './redis.service.js';

describe('RedisService', () => {
  it('shares the initial connection while concurrent callers wait for Redis', async () => {
    let resolveConnection!: () => void;
    const connected = new Promise<void>((resolve) => {
      resolveConnection = resolve;
    });
    let connectCalls = 0;
    const client: { connect: () => Promise<void>; status: string } = {
      connect: () => {
        connectCalls += 1;
        return connected.then(() => {
          client.status = 'ready';
        });
      },
      status: 'wait',
    };
    const service = Object.create(RedisService.prototype) as RedisService;
    Object.assign(service as unknown as { client: typeof client }, { client });

    const first = service.ensureConnected();
    const second = service.ensureConnected();
    expect(connectCalls).toBe(1);

    resolveConnection();
    await expect(Promise.all([first, second])).resolves.toEqual([client, client]);
  });
});
