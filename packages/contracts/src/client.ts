import createClient, { type Client, type ClientOptions } from 'openapi-fetch';

import type { paths } from './generated/v1.js';

export const API_V1_PATH_PREFIX = '/api/v1' as const;

export type VistaApiClientV1 = Client<paths>;

/**
 * Creates the shared client used by all browser applications. Generated paths
 * already include /api/v1, so legacy base URLs ending in that prefix are
 * normalized to their origin to avoid duplicating the version segment.
 */
export function createVistaApiClientV1(options: ClientOptions = {}): VistaApiClientV1 {
  return createClient<paths>({
    ...options,
    baseUrl: normalizeVistaApiBaseUrl(options.baseUrl),
    fetch: options.fetch ?? fetchRequestByUrl,
  });
}

export function normalizeVistaApiBaseUrl(value?: string): string {
  const baseUrl = value?.trim().replace(/\/+$/u, '') ?? '';
  return baseUrl.endsWith(API_V1_PATH_PREFIX)
    ? baseUrl.slice(0, -API_V1_PATH_PREFIX.length)
    : baseUrl;
}

export function resolveVistaBrowserApiBaseUrl(value: unknown, origin: string): string {
  const configured = typeof value === 'string' && value.trim() ? value.trim() : API_V1_PATH_PREFIX;
  return new URL(configured, origin.replace(/\/+$/u, '') + '/').toString().replace(/\/+$/u, '');
}

/**
 * Resolves the host fetch function at request time and preserves the established
 * URL-plus-options transport boundary used by the browser applications.
 */
async function fetchRequestByUrl(request: Request): Promise<Response> {
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.clone().text();

  const init: RequestInit = {
    cache: request.cache,
    credentials: request.credentials,
    headers: request.headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  };
  if (body) init.body = body;

  const location = globalThis.location;
  const parsedUrl = new URL(request.url);
  const input =
    location && parsedUrl.origin === location.origin
      ? parsedUrl.pathname + parsedUrl.search + parsedUrl.hash
      : request.url;

  return globalThis.fetch(input, init);
}
