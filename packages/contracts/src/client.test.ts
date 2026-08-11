import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  API_V1_PATH_PREFIX,
  createVistaApiClientV1,
  normalizeVistaApiBaseUrl,
  resolveVistaBrowserApiBaseUrl,
  type VistaApiClientV1,
} from './client.js';

describe('generated API client', () => {
  it('preserves the established API base URL configuration without duplicating v1', async () => {
    const fetchMock = vi.fn((request: Request) => {
      expect(request.url).toBe('http://localhost:3000/api/v1/health/live');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            checks: {},
            status: 'ok',
            timestamp: '2026-08-11T00:00:00.000Z',
            version: '0.1.0',
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        ),
      );
    });
    const client = createVistaApiClientV1({
      baseUrl: 'http://localhost:3000/api/v1/',
      fetch: fetchMock,
    });

    const result = await client.GET('/api/v1/health/live');

    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expectTypeOf(client).toEqualTypeOf<VistaApiClientV1>();
  });

  it('normalizes only the terminal version prefix', () => {
    expect(API_V1_PATH_PREFIX).toBe('/api/v1');
    expect(normalizeVistaApiBaseUrl('/api/v1')).toBe('');
    expect(normalizeVistaApiBaseUrl('https://vista.example/api/v1/')).toBe('https://vista.example');
    expect(normalizeVistaApiBaseUrl('https://vista.example/gateway')).toBe(
      'https://vista.example/gateway',
    );
    expect(resolveVistaBrowserApiBaseUrl(undefined, 'https://vista.example')).toBe(
      'https://vista.example/api/v1',
    );
    expect(
      resolveVistaBrowserApiBaseUrl('https://api.vista.example/api/v1/', 'https://vista.example'),
    ).toBe('https://api.vista.example/api/v1');
  });
});
