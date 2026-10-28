import { Readable } from 'node:stream';

import type { AppEnvironment, BackupWebDavSourceConfig } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import { ObjectStorageBackupArchive } from './object-storage-backup-archive.js';
import {
  resolveWebDavBackupSource,
  webDavArchiveNamespace,
  webDavSourceIdentity,
} from './webdav-backup-source.js';

const config: BackupWebDavSourceConfig = {
  endpoint: 'http://cloud.example.invalid/dav/users/vista/',
  password: 'deployment-only-password',
  username: 'backup-reader',
};

const environment = {
  BACKUP_WEBDAV_SOURCE_CONFIGS_JSON: { 'CLOUD-DOCUMENTS': config },
  VISTA_DEPLOYMENT_STAGE: 'local',
} as unknown as AppEnvironment;

describe('WebDAV cloud backup source', () => {
  it('archives files recursively through read-only PROPFIND and GET requests', async () => {
    const contents = new Map([
      ['/dav/users/vista/Documents/guide.txt', Buffer.from('first file')],
      ['/dav/users/vista/Documents/Reports/month.csv', Buffer.from('second file')],
    ]);
    const etags = new Map([
      ['/dav/users/vista/Documents/guide.txt', '"guide-v1"'],
      ['/dav/users/vista/Documents/Reports/month.csv', '"month-v1"'],
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      await Promise.resolve();
      const requestUrl = input instanceof Request ? input.url : input.toString();
      const url = new URL(requestUrl);
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('backup-reader:deployment-only-password').toString('base64')}`,
      });
      expect(init?.method).not.toBe('PUT');
      if (init?.method === 'PROPFIND') {
        const entries = propfindEntries(url.pathname, contents, etags);
        return new Response(multistatus(entries), {
          headers: { 'content-type': 'application/xml; charset=utf-8' },
          status: 207,
        });
      }
      if (init?.method === 'GET') {
        const content = contents.get(url.pathname);
        if (!content) return new Response(null, { status: 404 });
        return new Response(content, {
          headers: {
            'content-length': String(content.length),
            etag: etags.get(url.pathname) ?? '',
          },
          status: 200,
        });
      }
      return new Response(null, { status: 405 });
    });
    const handle = resolveWebDavBackupSource(
      'cloud-documents',
      'Documents',
      environment,
      fetchImpl,
    );
    const archive = new ObjectStorageBackupArchive();
    const archiveChunks: Buffer[] = [];
    for await (const chunk of archive.open(handle.source)) archiveChunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(archiveChunks);
    const manifest = await archive.validate(Readable.from([bytes]), handle.namespace);

    expect(handle.namespace).toMatch(/^webdav-[a-f0-9]{64}$/u);
    expect(manifest.objects.map(({ key }) => key)).toEqual(['guide.txt', 'Reports/month.csv']);
    expect(manifest.objects.find(({ key }) => key === 'guide.txt')?.contentType).toBe('text/plain');
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PROPFIND')).toBe(true);
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'GET')).toBe(true);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });

  it('binds source identity to endpoint, account and folder but not the password', () => {
    const rootUrl = new URL('https://cloud.example.invalid/dav/users/vista/Documents/');
    const identity = webDavSourceIdentity('CLOUD-DOCUMENTS', config, rootUrl);
    expect(webDavArchiveNamespace(identity)).toBe(`webdav-${identity}`);
    expect(
      webDavSourceIdentity('CLOUD-DOCUMENTS', { ...config, password: 'rotated-secret' }, rootUrl),
    ).toBe(identity);
    expect(
      webDavSourceIdentity(
        'CLOUD-DOCUMENTS',
        { ...config, endpoint: 'https://other.example.invalid/dav/' },
        rootUrl,
      ),
    ).not.toBe(identity);
  });

  it('rejects unsafe locations, redirects and paths outside the configured folder', async () => {
    expect(() => resolveWebDavBackupSource('CLOUD-DOCUMENTS', '../private', environment)).toThrow(
      'BACKUP_WEBDAV_LOCATION_INVALID',
    );
    expect(() =>
      resolveWebDavBackupSource('CLOUD-DOCUMENTS', 'Documents', {
        ...environment,
        VISTA_DEPLOYMENT_STAGE: 'production',
      }),
    ).toThrow('BACKUP_WEBDAV_TLS_REQUIRED');

    const fetchImpl = vi.fn(async () => {
      await Promise.resolve();
      return new Response(
        multistatus([
          { href: '/dav/users/vista/Documents/', collection: true },
          { href: '/dav/users/vista/Private/secret.txt', etag: '"private"', size: 1 },
        ]),
        { status: 207 },
      );
    });
    const handle = resolveWebDavBackupSource(
      'CLOUD-DOCUMENTS',
      'Documents',
      environment,
      fetchImpl,
    );
    await expect(handle.source.listFileObjects()).rejects.toThrow(
      'BACKUP_WEBDAV_HREF_OUTSIDE_SOURCE',
    );
  });
});

function propfindEntries(
  path: string,
  contents: Map<string, Buffer>,
  etags: Map<string, string>,
): Array<{
  collection?: boolean;
  contentType?: string;
  etag?: string;
  href: string;
  size?: number;
}> {
  const root = '/dav/users/vista/Documents/';
  if (path === root) {
    return [
      { href: root, collection: true },
      { href: `${root}Reports/`, collection: true },
      {
        contentType: 'text/plain',
        etag: etags.get(`${root}guide.txt`)!,
        href: `${root}guide.txt`,
        size: contents.get(`${root}guide.txt`)!.length,
      },
    ];
  }
  if (path === `${root}Reports/`) {
    return [
      { href: `${root}Reports/`, collection: true },
      {
        contentType: 'text/csv',
        etag: etags.get(`${root}Reports/month.csv`)!,
        href: `${root}Reports/month.csv`,
        size: contents.get(`${root}Reports/month.csv`)!.length,
      },
    ];
  }
  const item = [...contents.keys()].find((key) => key === path);
  return item
    ? [
        {
          contentType: item.endsWith('.csv') ? 'text/csv' : 'text/plain',
          etag: etags.get(item)!,
          href: item,
          size: contents.get(item)!.length,
        },
      ]
    : [];
}

function multistatus(
  entries: Array<{
    collection?: boolean;
    contentType?: string;
    etag?: string;
    href: string;
    size?: number;
  }>,
): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries
    .map(
      (entry) => `<d:response><d:href>${entry.href}</d:href><d:propstat><d:prop>
        <d:resourcetype>${entry.collection ? '<d:collection/>' : ''}</d:resourcetype>
        ${entry.size === undefined ? '' : `<d:getcontentlength>${entry.size}</d:getcontentlength>`}
        ${entry.etag === undefined ? '' : `<d:getetag>${entry.etag}</d:getetag>`}
        ${entry.contentType === undefined ? '' : `<d:getcontenttype>${entry.contentType}</d:getcontenttype>`}
      </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
    )
    .join('')}</d:multistatus>`;
}
