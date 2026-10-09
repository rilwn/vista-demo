import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedisService } from './redis.service.js';

describe('RedisService', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for a short reconnect without creating another connection', async () => {
    const client = Object.assign(new EventEmitter(), { status: 'reconnecting', connect: vi.fn() });
    const service = Object.create(RedisService.prototype) as RedisService;
    Object.assign(service, { client });
    const pending = service.ensureConnected();
    client.status = 'ready';
    client.emit('ready');
    await expect(pending).resolves.toBe(client);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.listenerCount('ready')).toBe(0);
    expect(client.listenerCount('end')).toBe(0);
  });

  it('fails closed after a bounded reconnect wait and removes listeners', async () => {
    vi.useFakeTimers();
    const client = Object.assign(new EventEmitter(), { status: 'reconnecting' });
    const service = Object.create(RedisService.prototype) as RedisService;
    Object.assign(service, { client });
    const pending = expect(service.ensureConnected()).rejects.toThrow('Redis readiness timed out');
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(client.listenerCount('ready')).toBe(0);
    expect(client.listenerCount('end')).toBe(0);
  });

  it('rejects a closed connection without bypassing dependency checks', async () => {
    const client = Object.assign(new EventEmitter(), { status: 'reconnecting' });
    const service = Object.create(RedisService.prototype) as RedisService;
    Object.assign(service, { client });
    const pending = expect(service.ensureConnected()).rejects.toThrow('Redis connection ended');
    client.status = 'end';
    client.emit('end');
    await pending;
    expect(client.listenerCount('ready')).toBe(0);
  });

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
