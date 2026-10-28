import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { AppEnvironment, BackupEmailSourceConfig } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import {
  emailArchiveNamespace,
  emailImapBackupSourceSnapshot,
  emailSourceIdentity,
  emailSourceLocation,
  ImapEmailBackupSource,
  resolveEmailImapBackupSource,
} from './email-imap-backup-source.js';
import { ObjectStorageBackupArchive } from './object-storage-backup-archive.js';
import type { FetchMessageObject, ImapFlow, ImapFlowOptions } from 'imapflow';

const config: BackupEmailSourceConfig = {
  host: 'mail.example.invalid',
  mailboxes: ['INBOX'],
  password: 'not-for-logs',
  port: 993,
  tlsMode: 'implicit',
  username: 'backup@example.invalid',
};

const rawMessage = Buffer.from(
  'From: sender@example.invalid\r\nTo: receiver@example.invalid\r\nSubject: Backup evidence\r\n\r\nMessage body.\r\n',
);

function message(overrides: Partial<FetchMessageObject> = {}): FetchMessageObject {
  return {
    envelope: {
      date: new Date('2026-10-01T08:00:00.000Z'),
      from: [{ address: 'sender@example.invalid', name: 'Sender' }],
      subject: 'Backup evidence',
    },
    flags: new Set(['\\Seen']),
    internalDate: new Date('2026-10-01T08:00:00.000Z'),
    modseq: 42n,
    seq: 1,
    size: rawMessage.length,
    uid: 17,
    ...overrides,
  };
}

function makeClient(initialMessages = [message()], rawMessages = new Map([[17, rawMessage]])) {
  let currentMessages = initialMessages;
  let mailbox: false | { readOnly: boolean; uidValidity: bigint } = false;
  const options: ImapFlowOptions[] = [];
  const client = {
    close: vi.fn(),
    connect: vi.fn(() => Promise.resolve()),
    download: vi.fn((sequence: string) => {
      const content = rawMessages.get(Number(sequence)) ?? rawMessage;
      return Promise.resolve({
        content: Readable.from([content]),
        meta: { expectedSize: content.length },
      });
    }),
    fetch: vi.fn(async function* () {
      await Promise.resolve();
      yield* currentMessages;
    }),
    fetchOne: vi.fn((sequence: string) =>
      Promise.resolve(currentMessages.find(({ uid }) => uid === Number(sequence)) ?? false),
    ),
    getMailboxLock: vi.fn((_path: string, lockOptions: { readOnly?: boolean }) => {
      mailbox = { readOnly: lockOptions.readOnly === true, uidValidity: 9_001n };
      return Promise.resolve({ release: vi.fn() });
    }),
    get isClosed() {
      return false;
    },
    get mailbox() {
      return mailbox;
    },
    logout: vi.fn(() => Promise.resolve()),
    setMessage(next: FetchMessageObject) {
      currentMessages = [next];
    },
    setMessages(next: FetchMessageObject[]) {
      currentMessages = next;
    },
  };
  const factory = vi.fn((clientOptions: ImapFlowOptions) => {
    options.push(clientOptions);
    return client as unknown as ImapFlow;
  });
  return { client, factory, options };
}

describe('IMAP email backup source', () => {
  it('uses protected source configuration without exposing credentials in its identity', () => {
    const environment = {
      BACKUP_EMAIL_SOURCE_CONFIGS_JSON: { 'VISTA-MAIL-01': config },
      VISTA_DEPLOYMENT_STAGE: 'staging',
    } as unknown as Pick<
      AppEnvironment,
      'BACKUP_EMAIL_SOURCE_CONFIGS_JSON' | 'VISTA_DEPLOYMENT_STAGE'
    >;
    const location = emailSourceLocation(config);
    const snapshot = emailImapBackupSourceSnapshot('vista-mail-01', location, environment);
    const handle = resolveEmailImapBackupSource('VISTA-MAIL-01', location, environment);

    expect(snapshot).toEqual({ identity: handle.identity, namespace: handle.namespace });
    expect(handle.namespace).toBe(emailArchiveNamespace(handle.identity));
    expect(handle.identity).toBe(emailSourceIdentity('VISTA-MAIL-01', config));
    expect(handle.identity).not.toContain(config.password);
    expect(() =>
      emailImapBackupSourceSnapshot(
        'VISTA-MAIL-01',
        'imaps://other.example.invalid:993',
        environment,
      ),
    ).toThrow('BACKUP_EMAIL_SOURCE_LOCATION_MISMATCH');
  });

  it('backs up complete RFC822 messages using a read-only TLS mailbox session', async () => {
    const { client, factory, options } = makeClient();
    const source = new ImapEmailBackupSource(config, 'email-test-namespace', 'staging', factory);
    try {
      const listed = await source.listFileObjects();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.key).toBe('mailboxes/INBOX/uidvalidity-9001/17.eml');
      expect(options[0]).toMatchObject({ logger: false, secure: true, host: config.host });
      expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true });

      const description = await source.describeFileObject(listed[0]!.key);
      expect(description).toMatchObject({
        contentType: 'message/rfc822',
        metadata: {
          'email-from': 'sender@example.invalid',
          'email-mailbox': 'INBOX',
          'email-subject': 'Backup evidence',
        },
        size: rawMessage.length,
      });

      const downloaded = await source.getFileObjectStream(listed[0]!.key);
      const chunks: Buffer[] = [];
      for await (const chunk of downloaded.body) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(rawMessage);
      expect(downloaded.etag).toBe(listed[0]?.etag);
      expect(client.download).toHaveBeenCalledWith('17', undefined, {
        maxBytes: 256 * 1024 * 1024,
        uid: true,
      });
      expect(client.logout).not.toHaveBeenCalled();
    } finally {
      await source.close();
    }
    expect(client.logout).toHaveBeenCalledOnce();
  });

  it('rejects a message that changed after listing instead of archiving mixed data', async () => {
    const { client, factory } = makeClient();
    const source = new ImapEmailBackupSource(config, 'email-test-namespace', 'staging', factory);
    const listed = await source.listFileObjects();
    client.setMessage(message({ flags: new Set(['\\Seen', '\\Flagged']) }));

    await expect(source.getFileObjectStream(listed[0]!.key)).rejects.toThrow(
      'BACKUP_SOURCE_CHANGED_DURING_SCAN',
    );
    await source.close();
  });

  it('rejects cleartext authentication outside local development', async () => {
    const { factory } = makeClient();
    const cleartextConfig = { ...config, port: 143, tlsMode: 'none' as const };
    const source = new ImapEmailBackupSource(
      cleartextConfig,
      'email-test-namespace',
      'production',
      factory,
    );

    await expect(source.listFileObjects()).rejects.toThrow('BACKUP_EMAIL_TLS_REQUIRED');
    expect(factory).not.toHaveBeenCalled();
  });

  it('backs up an incremental mail change and restores one message from the verified chain', async () => {
    const secondMessage = Buffer.from(
      'From: other@example.invalid\r\nTo: receiver@example.invalid\r\nSubject: Second message\r\n\r\nSecond body.\r\n',
    );
    const firstMetadata = message({ size: rawMessage.length, uid: 17 });
    const secondMetadata = message({
      envelope: {
        date: new Date('2026-10-02T08:00:00.000Z'),
        from: [{ address: 'other@example.invalid', name: 'Other' }],
        subject: 'Second message',
      },
      internalDate: new Date('2026-10-02T08:00:00.000Z'),
      modseq: 43n,
      seq: 2,
      size: secondMessage.length,
      uid: 18,
    });
    const namespace = 'email-test-namespace';
    const first = makeClient([firstMetadata]);
    const fullSource = new ImapEmailBackupSource(config, namespace, 'staging', first.factory);
    const archive = new ObjectStorageBackupArchive();
    const fullChunks: Buffer[] = [];
    for await (const chunk of archive.open(fullSource)) fullChunks.push(chunk);
    const fullBytes = Buffer.concat(fullChunks);
    const baseline = await archive.validate(Readable.from([fullBytes]), namespace);

    const next = makeClient(
      [firstMetadata, secondMetadata],
      new Map([
        [17, rawMessage],
        [18, secondMessage],
      ]),
    );
    const incrementalSource = new ImapEmailBackupSource(config, namespace, 'staging', next.factory);
    const incrementalChunks: Buffer[] = [];
    for await (const chunk of archive.open(incrementalSource, {
      backupType: 'incremental',
      baseline,
    }))
      incrementalChunks.push(chunk);
    const incrementalBytes = Buffer.concat(incrementalChunks);
    const incremental = await archive.validate(Readable.from([incrementalBytes]), namespace);
    expect(incremental.objects.map(({ key }) => key)).toEqual([
      'mailboxes/INBOX/uidvalidity-9001/17.eml',
      'mailboxes/INBOX/uidvalidity-9001/18.eml',
    ]);
    expect(incremental.objects.find(({ key }) => key.endsWith('/17.eml'))?.contentIncluded).toBe(
      false,
    );

    const directory = await mkdtemp(join(tmpdir(), 'vista-email-archive-test-'));
    if (!directory.startsWith(join(tmpdir(), 'vista-email-archive-test-'))) {
      throw new Error('Unexpected email archive test directory');
    }
    const fullPath = join(directory, `${randomUUID()}.archive`);
    const incrementalPath = join(directory, `${randomUUID()}.archive`);
    const restored = new Map<string, Buffer>();
    const storage = {
      putRestoredFileObject: vi.fn(async ({ body, key }: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        restored.set(key, Buffer.concat(chunks));
      }),
    };
    try {
      await writeFile(fullPath, fullBytes, { mode: 0o600 });
      await writeFile(incrementalPath, incrementalBytes, { mode: 0o600 });
      const targetPrefix = 'restores/7a2ec5d06b0149c7ae112137281df13c/attempt-1/';
      await archive.restoreChain(
        [fullPath, incrementalPath],
        namespace,
        storage as never,
        targetPrefix,
        'mailboxes/INBOX/uidvalidity-9001/18.eml',
      );
      expect(restored.size).toBe(1);
      expect(restored.get(`${targetPrefix}mailboxes/INBOX/uidvalidity-9001/18.eml`)).toEqual(
        secondMessage,
      );
    } finally {
      if (directory.startsWith(join(tmpdir(), 'vista-email-archive-test-'))) {
        await rm(directory, { force: true, recursive: true });
      }
    }
  }, 30_000);
});
