import { SaxesParser } from 'saxes';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import type { AppEnvironment, BackupWebDavSourceConfig } from '@vista/config';

import type { ObjectStorageBackupSource } from './object-storage-backup-archive.js';

const metadataRequestTimeoutMs = 30_000;
const contentRequestTimeoutMs = 30 * 60_000;
const maxObjects = 100_000;
const maxDirectoryDepth = 40;
const maxDavResponseBytes = 16 * 1024 * 1024;

type WebDavEnvironment = Pick<
  AppEnvironment,
  'BACKUP_WEBDAV_SOURCE_CONFIGS_JSON' | 'VISTA_DEPLOYMENT_STAGE'
>;

type WebDavFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WebDavBackupSourceHandle {
  identity: string;
  namespace: string;
  source: ObjectStorageBackupSource;
}

interface DavObject {
  contentType?: string;
  etag: string;
  modifiedAt?: string;
  size: number;
  url: string;
}

interface DavResponse {
  contentType?: string;
  etag?: string;
  href: string;
  isCollection: boolean;
  lastModified?: string;
  size?: string;
}

interface DavPropstat {
  contentType?: string;
  etag?: string;
  isCollection: boolean;
  lastModified?: string;
  size?: string;
  status?: string;
}

export function resolveWebDavBackupSource(
  sourceCode: string | null,
  location: string | null,
  environment: WebDavEnvironment,
  fetchImpl: WebDavFetch = globalThis.fetch.bind(globalThis),
): WebDavBackupSourceHandle {
  const normalizedSourceCode = normalizeSourceCode(sourceCode);
  const config = environment.BACKUP_WEBDAV_SOURCE_CONFIGS_JSON[normalizedSourceCode];
  if (!config) throw new Error('BACKUP_WEBDAV_SOURCE_NOT_CONFIGURED');
  const rootUrl = configuredRootUrl(config, location);
  if (environment.VISTA_DEPLOYMENT_STAGE !== 'local' && rootUrl.protocol !== 'https:') {
    throw new Error('BACKUP_WEBDAV_TLS_REQUIRED');
  }
  const identity = webDavSourceIdentity(normalizedSourceCode, config, rootUrl);
  const namespace = webDavArchiveNamespace(identity);
  return {
    identity,
    namespace,
    source: new WebDavBackupSource(config, rootUrl, namespace, fetchImpl),
  };
}

export function webDavBackupSourceSnapshot(
  sourceCode: string | null,
  location: string | null,
  environment: WebDavEnvironment,
): { identity: string; namespace: string } {
  const normalizedSourceCode = normalizeSourceCode(sourceCode);
  const config = environment.BACKUP_WEBDAV_SOURCE_CONFIGS_JSON[normalizedSourceCode];
  if (!config) throw new Error('BACKUP_WEBDAV_SOURCE_NOT_CONFIGURED');
  const rootUrl = configuredRootUrl(config, location);
  if (environment.VISTA_DEPLOYMENT_STAGE !== 'local' && rootUrl.protocol !== 'https:') {
    throw new Error('BACKUP_WEBDAV_TLS_REQUIRED');
  }
  const identity = webDavSourceIdentity(normalizedSourceCode, config, rootUrl);
  return { identity, namespace: webDavArchiveNamespace(identity) };
}

export function webDavSourceIdentity(
  sourceCode: string,
  config: BackupWebDavSourceConfig,
  rootUrl: URL,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        endpoint: normalizeEndpoint(config.endpoint),
        root: rootUrl.pathname,
        sourceCode: sourceCode.trim().toUpperCase(),
        username: config.username.trim(),
      }),
    )
    .digest('hex');
}

export function webDavArchiveNamespace(identity: string): string {
  if (!/^[a-f0-9]{64}$/u.test(identity)) {
    throw new Error('BACKUP_WEBDAV_SOURCE_IDENTITY_INVALID');
  }
  return `webdav-${identity}`;
}

export class WebDavBackupSource implements ObjectStorageBackupSource {
  private readonly objects = new Map<string, DavObject>();

  constructor(
    private readonly config: BackupWebDavSourceConfig,
    private readonly rootUrl: URL,
    private readonly namespace: string,
    private readonly fetchImpl: WebDavFetch = globalThis.fetch.bind(globalThis),
  ) {}

  bucketName(): string {
    return this.namespace;
  }

  async listFileObjects(): Promise<Array<{ etag: string; key: string; size: number }>> {
    const pending: Array<{ depth: number; url: URL }> = [{ depth: 0, url: this.rootUrl }];
    const visited = new Set<string>();
    const objects = new Map<string, DavObject>();
    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) break;
      const directoryUrl = ensureTrailingSlash(current.url);
      const directoryKey = directoryUrl.href;
      if (visited.has(directoryKey)) throw new Error('BACKUP_WEBDAV_DIRECTORY_LOOP');
      visited.add(directoryKey);
      if (current.depth > maxDirectoryDepth) throw new Error('BACKUP_WEBDAV_DEPTH_LIMIT_EXCEEDED');
      for (const entry of await this.propfind(directoryUrl, '1')) {
        const href = this.resolveHref(directoryUrl, entry.href);
        if (samePath(href, directoryUrl)) continue;
        const key = this.keyFromUrl(href);
        if (entry.isCollection) {
          pending.push({ depth: current.depth + 1, url: ensureTrailingSlash(href) });
          continue;
        }
        const object = this.objectFromResponse(href, entry);
        if (objects.has(key)) throw new Error('BACKUP_WEBDAV_DUPLICATE_OBJECT');
        objects.set(key, object);
        if (objects.size > maxObjects) throw new Error('BACKUP_OBJECT_COUNT_LIMIT_EXCEEDED');
      }
    }
    this.objects.clear();
    for (const [key, object] of objects) this.objects.set(key, object);
    return [...objects.entries()]
      .map(([key, object]) => ({ etag: object.etag, key, size: object.size }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async describeFileObject(key: string) {
    const expected = this.objects.get(key);
    if (!expected) throw new Error('BACKUP_WEBDAV_OBJECT_NOT_IN_SOURCE_LIST');
    const url = this.urlForKey(key);
    const entries = await this.propfind(url, '0');
    const current = entries
      .map((entry) => ({ entry, url: this.resolveHref(url, entry.href) }))
      .find((item) => samePath(item.url, url) && !item.entry.isCollection)?.entry;
    if (!current) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
    const object = this.objectFromResponse(url, current);
    if (!sameObject(expected, object)) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
    return {
      ...(object.contentType ? { contentType: object.contentType } : {}),
      etag: object.etag,
      size: object.size,
    };
  }

  async getFileObjectStream(key: string): Promise<{ body: Readable; etag: string; size: number }> {
    const expected = this.objects.get(key);
    if (!expected) throw new Error('BACKUP_WEBDAV_OBJECT_NOT_IN_SOURCE_LIST');
    const response = await this.request(this.urlForKey(key), 'GET');
    if (!response.ok || !response.body) throw new Error('BACKUP_WEBDAV_OBJECT_READ_FAILED');
    const etag = response.headers.get('etag') ?? undefined;
    const length = parseLength(response.headers.get('content-length'));
    if (
      (etag !== undefined && etag !== expected.etag) ||
      (length !== undefined && length !== expected.size)
    ) {
      await response.body.cancel();
      throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
    }
    return {
      body: Readable.fromWeb(response.body as ReadableStream),
      etag: expected.etag,
      size: expected.size,
    };
  }

  private async propfind(url: URL, depth: '0' | '1'): Promise<DavResponse[]> {
    const response = await this.request(
      url,
      'PROPFIND',
      {
        Depth: depth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      davPropfindBody,
    );
    if (response.status !== 207) throw new Error('BACKUP_WEBDAV_PROPFIND_FAILED');
    const xml = await readResponseText(response);
    return parseDavResponses(xml);
  }

  private async request(
    url: URL,
    method: 'GET' | 'PROPFIND',
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...(body ? { body } : {}),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
          ...headers,
        },
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(
          method === 'GET' ? contentRequestTimeoutMs : metadataRequestTimeoutMs,
        ),
      });
    } catch {
      throw new Error('BACKUP_WEBDAV_REQUEST_FAILED');
    }
    return response;
  }

  private objectFromResponse(url: URL, response: DavResponse): DavObject {
    const size = parseLength(response.size);
    if (
      !response.etag ||
      /^W\//iu.test(response.etag) ||
      size === undefined ||
      response.isCollection
    ) {
      throw new Error('BACKUP_WEBDAV_OBJECT_VERSION_UNAVAILABLE');
    }
    return {
      ...(response.contentType ? { contentType: response.contentType } : {}),
      etag: response.etag,
      ...(response.lastModified ? { modifiedAt: response.lastModified } : {}),
      size,
      url: url.href,
    };
  }

  private resolveHref(parent: URL, href: string): URL {
    let resolved: URL;
    try {
      resolved = new URL(href, parent);
    } catch {
      throw new Error('BACKUP_WEBDAV_HREF_INVALID');
    }
    if (
      resolved.origin !== this.rootUrl.origin ||
      resolved.username ||
      resolved.password ||
      resolved.search ||
      resolved.hash ||
      !resolved.pathname.startsWith(this.rootUrl.pathname)
    ) {
      throw new Error('BACKUP_WEBDAV_HREF_OUTSIDE_SOURCE');
    }
    return resolved;
  }

  private keyFromUrl(url: URL): string {
    const encodedPath = url.pathname.slice(this.rootUrl.pathname.length).replace(/\/$/u, '');
    let key: string;
    try {
      key = encodedPath
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/');
    } catch {
      throw new Error('BACKUP_WEBDAV_OBJECT_KEY_INVALID');
    }
    if (
      !key ||
      key.length > 1024 ||
      key
        .split('/')
        .some(
          (segment) =>
            !segment || segment === '.' || segment === '..' || containsUnsafePathCharacter(segment),
        )
    ) {
      throw new Error('BACKUP_WEBDAV_OBJECT_KEY_INVALID');
    }
    return key;
  }

  private urlForKey(key: string): URL {
    if (
      !key ||
      key.length > 1024 ||
      key
        .split('/')
        .some(
          (segment) =>
            !segment || segment === '.' || segment === '..' || containsUnsafePathCharacter(segment),
        )
    ) {
      throw new Error('BACKUP_WEBDAV_OBJECT_KEY_INVALID');
    }
    const url = new URL(key.split('/').map(encodeURIComponent).join('/'), this.rootUrl);
    if (url.origin !== this.rootUrl.origin || !url.pathname.startsWith(this.rootUrl.pathname)) {
      throw new Error('BACKUP_WEBDAV_HREF_OUTSIDE_SOURCE');
    }
    return url;
  }
}

function configuredRootUrl(config: BackupWebDavSourceConfig, location: string | null): URL {
  const base = normalizeEndpoint(config.endpoint);
  if (!location || location.length > 1024 || containsUnsafePathCharacter(location)) {
    throw new Error('BACKUP_WEBDAV_LOCATION_INVALID');
  }
  const segments = location === '.' ? [] : location.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('BACKUP_WEBDAV_LOCATION_INVALID');
  }
  const root = new URL(segments.map(encodeURIComponent).join('/'), base);
  if (!root.pathname.startsWith(base.pathname)) throw new Error('BACKUP_WEBDAV_LOCATION_INVALID');
  return ensureTrailingSlash(root);
}

function normalizeEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('BACKUP_WEBDAV_ENDPOINT_INVALID');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    !endpoint.hostname ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('BACKUP_WEBDAV_ENDPOINT_INVALID');
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, '')}/`;
  return endpoint;
}

function containsUnsafePathCharacter(value: string): boolean {
  return (
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

function normalizeSourceCode(sourceCode: string | null): string {
  const normalized = sourceCode?.trim().toUpperCase();
  if (!normalized) throw new Error('BACKUP_WEBDAV_SOURCE_CODE_MISSING');
  return normalized;
}

function ensureTrailingSlash(url: URL): URL {
  const result = new URL(url);
  if (!result.pathname.endsWith('/')) result.pathname += '/';
  return result;
}

function samePath(left: URL, right: URL): boolean {
  return (
    left.origin === right.origin &&
    left.pathname.replace(/\/+$/u, '/') === right.pathname.replace(/\/+$/u, '/')
  );
}

function parseLength(value: string | undefined | null): number | undefined {
  if (value === undefined || value === null || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sameObject(left: DavObject, right: DavObject): boolean {
  return (
    left.etag === right.etag &&
    left.size === right.size &&
    left.contentType === right.contentType &&
    left.modifiedAt === right.modifiedAt &&
    samePath(new URL(left.url), new URL(right.url))
  );
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) throw new Error('BACKUP_WEBDAV_RESPONSE_EMPTY');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxDavResponseBytes) throw new Error('BACKUP_WEBDAV_RESPONSE_TOO_LARGE');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('BACKUP_WEBDAV_XML_INVALID');
  }
}

function parseDavResponses(xml: string): DavResponse[] {
  if (xml.length > maxDavResponseBytes || /<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new Error('BACKUP_WEBDAV_XML_INVALID');
  }
  const responses: DavResponse[] = [];
  let response: DavResponse | undefined;
  let propstat: DavPropstat | undefined;
  let textElement: 'contentType' | 'etag' | 'href' | 'lastModified' | 'size' | 'status' | undefined;
  let text = '';
  let sawMultiStatus = false;
  let parseError: Error | undefined;
  const stack: string[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag) => {
    const name = localName(tag.name);
    const parent = stack.at(-1);
    if (name === 'multistatus') sawMultiStatus = true;
    if (name === 'response') response = { href: '', isCollection: false };
    if (name === 'propstat') propstat = { isCollection: false };
    if (name === 'collection' && stack.includes('resourcetype') && propstat) {
      propstat.isCollection = true;
    }
    if (name === 'href' && parent === 'response') textElement = 'href';
    if (name === 'status' && parent === 'propstat') textElement = 'status';
    if (parent === 'prop') {
      if (name === 'getcontentlength') textElement = 'size';
      if (name === 'getetag') textElement = 'etag';
      if (name === 'getlastmodified') textElement = 'lastModified';
      if (name === 'getcontenttype') textElement = 'contentType';
    }
    if (textElement) text = '';
    stack.push(name);
  });
  parser.on('text', (value) => {
    if (textElement) text += value;
  });
  parser.on('closetag', (tag) => {
    const name = localName(typeof tag === 'string' ? tag : tag.name);
    const value = text.trim();
    if (textElement && name === textElementName(textElement)) {
      if (textElement === 'href' && response) response.href = value;
      if (textElement === 'status' && propstat) propstat.status = value;
      if (textElement === 'size' && propstat) propstat.size = value;
      if (textElement === 'etag' && propstat) propstat.etag = value;
      if (textElement === 'lastModified' && propstat) propstat.lastModified = value;
      if (textElement === 'contentType' && propstat) propstat.contentType = value;
      textElement = undefined;
      text = '';
    }
    if (name === 'propstat' && response && propstat) {
      if (/^HTTP\/\d\.\d 2\d\d(?:\s|$)/u.test(propstat.status ?? '')) {
        if (propstat.size !== undefined) response.size = propstat.size;
        if (propstat.etag !== undefined) response.etag = propstat.etag;
        if (propstat.lastModified !== undefined) response.lastModified = propstat.lastModified;
        if (propstat.contentType !== undefined) response.contentType = propstat.contentType;
        response.isCollection ||= propstat.isCollection;
      }
      propstat = undefined;
    }
    if (name === 'response' && response) {
      responses.push(response);
      response = undefined;
    }
    stack.pop();
  });
  parser.on('doctype', () => {
    parseError = new Error('BACKUP_WEBDAV_XML_INVALID');
  });
  parser.on('error', () => {
    parseError = new Error('BACKUP_WEBDAV_XML_INVALID');
  });
  try {
    parser.write(xml).close();
  } catch {
    parseError = new Error('BACKUP_WEBDAV_XML_INVALID');
  }
  if (parseError || !sawMultiStatus || responses.some((entry) => !entry.href)) {
    throw new Error('BACKUP_WEBDAV_XML_INVALID');
  }
  return responses;
}

function localName(name: string): string {
  return name.split(':').at(-1) ?? name;
}

function textElementName(
  value: 'contentType' | 'etag' | 'href' | 'lastModified' | 'size' | 'status',
): string {
  return value === 'size'
    ? 'getcontentlength'
    : value === 'etag'
      ? 'getetag'
      : value === 'lastModified'
        ? 'getlastmodified'
        : value === 'contentType'
          ? 'getcontenttype'
          : value;
}

const davPropfindBody =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:getcontenttype/></d:prop></d:propfind>';
