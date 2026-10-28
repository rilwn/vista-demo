import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ImapFlow, type FetchMessageObject, type ImapFlowOptions } from 'imapflow';
import type { AppEnvironment, BackupEmailSourceConfig } from '@vista/config';

import type { ObjectStorageBackupSource } from './object-storage-backup-archive.js';

const maxEmailBytes = 256 * 1024 * 1024;
const maxMailboxMessages = 100_000;

type EmailSourceEnvironment = Pick<
  AppEnvironment,
  'BACKUP_EMAIL_SOURCE_CONFIGS_JSON' | 'VISTA_DEPLOYMENT_STAGE'
>;

export interface EmailImapBackupSourceHandle {
  identity: string;
  namespace: string;
  source: ObjectStorageBackupSource;
}

export function resolveEmailImapBackupSource(
  sourceCode: string | null,
  location: string | null,
  environment: EmailSourceEnvironment,
): EmailImapBackupSourceHandle {
  const normalizedSourceCode = sourceCode?.trim().toUpperCase();
  if (!normalizedSourceCode) throw new Error('BACKUP_EMAIL_SOURCE_CODE_MISSING');
  const config = environment.BACKUP_EMAIL_SOURCE_CONFIGS_JSON[normalizedSourceCode];
  if (!config) throw new Error('BACKUP_EMAIL_SOURCE_NOT_CONFIGURED');
  assertLocationMatches(config, location);

  const identity = emailSourceIdentity(normalizedSourceCode, config);
  const namespace = emailArchiveNamespace(identity);
  return {
    identity,
    namespace,
    source: new ImapEmailBackupSource(config, namespace, environment.VISTA_DEPLOYMENT_STAGE),
  };
}

export function emailImapBackupSourceSnapshot(
  sourceCode: string | null,
  location: string | null,
  environment: EmailSourceEnvironment,
): { identity: string; namespace: string } {
  const normalizedSourceCode = sourceCode?.trim().toUpperCase();
  if (!normalizedSourceCode) throw new Error('BACKUP_EMAIL_SOURCE_CODE_MISSING');
  const config = environment.BACKUP_EMAIL_SOURCE_CONFIGS_JSON[normalizedSourceCode];
  if (!config) throw new Error('BACKUP_EMAIL_SOURCE_NOT_CONFIGURED');
  assertLocationMatches(config, location);
  const identity = emailSourceIdentity(normalizedSourceCode, config);
  return { identity, namespace: emailArchiveNamespace(identity) };
}

export function emailSourceIdentity(sourceCode: string, config: BackupEmailSourceConfig): string {
  const stableIdentity = JSON.stringify({
    host: config.host.toLowerCase(),
    mailboxes: [...config.mailboxes].sort(),
    port: config.port,
    sourceCode: sourceCode.toUpperCase(),
    tlsMode: config.tlsMode,
    username: config.username,
  });
  return createHash('sha256').update(stableIdentity).digest('hex');
}

export function emailArchiveNamespace(identity: string): string {
  if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('BACKUP_EMAIL_SOURCE_IDENTITY_INVALID');
  return `email-${identity}`;
}

export function emailSourceLocation(config: BackupEmailSourceConfig): string {
  const protocol = config.tlsMode === 'implicit' ? 'imaps:' : 'imap:';
  const host = config.host.includes(':') ? `[${config.host}]` : config.host;
  return `${protocol}//${host}:${config.port}`;
}

function assertLocationMatches(config: BackupEmailSourceConfig, location: string | null): void {
  if (!location) throw new Error('BACKUP_EMAIL_SOURCE_LOCATION_MISSING');
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(location);
    expected = new URL(emailSourceLocation(config));
  } catch {
    throw new Error('BACKUP_EMAIL_SOURCE_LOCATION_INVALID');
  }
  if (
    actual.protocol !== expected.protocol ||
    actual.hostname.toLowerCase() !== expected.hostname.toLowerCase() ||
    actual.port !== expected.port ||
    !['', '/'].includes(actual.pathname) ||
    actual.username ||
    actual.password ||
    actual.search ||
    actual.hash
  ) {
    throw new Error('BACKUP_EMAIL_SOURCE_LOCATION_MISMATCH');
  }
}

interface EmailMessageMetadata {
  etag: string;
  flags: string;
  internalDate: string;
  mailbox: string;
  size: number;
  subject: string;
  from: string;
  uid: number;
  uidValidity: string;
}

export type EmailImapClientFactory = (options: ImapFlowOptions) => ImapFlow;

export class ImapEmailBackupSource implements ObjectStorageBackupSource {
  private readonly messages = new Map<string, EmailMessageMetadata>();
  private client: ImapFlow | undefined;
  private closed = false;

  constructor(
    private readonly config: BackupEmailSourceConfig,
    private readonly namespace: string,
    private readonly deploymentStage: string,
    private readonly createClient: EmailImapClientFactory = (options) => new ImapFlow(options),
  ) {}

  bucketName(): string {
    return this.namespace;
  }

  async listFileObjects(): Promise<Array<{ etag: string; key: string; size: number }>> {
    const listed: Array<{ etag: string; key: string; size: number }> = [];
    this.messages.clear();
    const client = await this.getClient();
    for (const mailbox of this.config.mailboxes) {
      await this.withMailbox(client, mailbox, async () => {
        const selectedMailbox = client.mailbox;
        if (!selectedMailbox) throw new Error('BACKUP_EMAIL_MAILBOX_STATE_UNAVAILABLE');
        const uidValidity = selectedMailbox.uidValidity;
        for await (const message of client.fetch('1:*', {
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
          uid: true,
        })) {
          const metadata = toMessageMetadata(message, mailbox, String(uidValidity));
          const key = emailMessageKey(mailbox, metadata.uidValidity, metadata.uid);
          this.messages.set(key, metadata);
          listed.push({ etag: metadata.etag, key, size: metadata.size });
          if (listed.length > maxMailboxMessages) {
            throw new Error('BACKUP_EMAIL_MESSAGE_COUNT_LIMIT_EXCEEDED');
          }
        }
      });
    }
    return listed.sort((left, right) => left.key.localeCompare(right.key));
  }

  async describeFileObject(key: string) {
    const address = parseEmailMessageKey(key);
    const client = await this.getClient();
    return this.withMailbox(client, address.mailbox, async () => {
      const selectedMailbox = client.mailbox;
      if (!selectedMailbox || String(selectedMailbox.uidValidity) !== address.uidValidity) {
        throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
      }
      const message = await client.fetchOne(
        String(address.uid),
        {
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
          uid: true,
        },
        { uid: true },
      );
      if (!message) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
      const metadata = toMessageMetadata(message, address.mailbox, address.uidValidity);
      return emailObjectDescription(metadata);
    });
  }

  async getFileObjectStream(key: string): Promise<{ body: Readable; etag: string; size: number }> {
    const address = parseEmailMessageKey(key);
    const expected = this.messages.get(key);
    if (!expected) throw new Error('BACKUP_EMAIL_MESSAGE_NOT_IN_SOURCE_LIST');
    const client = await this.getClient();
    const lock = await client.getMailboxLock(address.mailbox, { readOnly: true });
    const selectedMailbox = client.mailbox;
    if (
      !selectedMailbox ||
      selectedMailbox.readOnly !== true ||
      String(selectedMailbox.uidValidity) !== address.uidValidity
    ) {
      lock.release();
      throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
    }
    try {
      const message = await client.fetchOne(
        String(address.uid),
        {
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
          uid: true,
        },
        { uid: true },
      );
      if (!message) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
      const current = toMessageMetadata(message, address.mailbox, address.uidValidity);
      if (!sameMessageMetadata(current, expected)) {
        throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
      }
      const downloaded = await client.download(String(address.uid), undefined, {
        maxBytes: maxEmailBytes,
        uid: true,
      });
      if (
        !downloaded.content ||
        (downloaded.meta.expectedSize !== undefined &&
          downloaded.meta.expectedSize !== expected.size)
      ) {
        downloaded.content?.destroy();
        throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
      }
      const content = downloaded.content;
      const closeIfClosed = () => (this.closed ? this.close() : Promise.resolve());
      const body = Readable.from(
        (async function* () {
          let bytesRead = 0;
          try {
            for await (const chunk of content) {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytesRead += bytes.length;
              if (bytesRead > expected.size || bytesRead > maxEmailBytes) {
                throw new Error('BACKUP_EMAIL_MESSAGE_SIZE_LIMIT_EXCEEDED');
              }
              yield bytes;
            }
            if (bytesRead !== expected.size) throw new Error('BACKUP_SOURCE_CHANGED_DURING_SCAN');
          } finally {
            lock.release();
            await closeIfClosed();
          }
        })(),
      );
      return { body, etag: expected.etag, size: expected.size };
    } catch (error) {
      lock.release();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    try {
      if (!client.isClosed) await client.logout();
    } catch {
      client.close();
    }
  }

  private async getClient(): Promise<ImapFlow> {
    if (this.closed) throw new Error('BACKUP_EMAIL_SOURCE_CLOSED');
    if (!this.client) {
      const options: ImapFlowOptions = {
        auth: { pass: this.config.password, user: this.config.username },
        connectionTimeout: 30_000,
        disableAutoIdle: true,
        doSTARTTLS: this.config.tlsMode === 'starttls',
        host: this.config.host,
        logger: false,
        maxLiteralSize: maxEmailBytes,
        port: this.config.port,
        secure: this.config.tlsMode === 'implicit',
        socketTimeout: 120_000,
      };
      if (this.config.tlsMode === 'none' && this.deploymentStage !== 'local') {
        throw new Error('BACKUP_EMAIL_TLS_REQUIRED');
      }
      const client = this.createClient(options);
      try {
        await client.connect();
        this.client = client;
      } catch (error) {
        client.close();
        throw error;
      }
    }
    return this.client;
  }

  private async withMailbox<T>(
    client: ImapFlow,
    mailbox: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      if (!client.mailbox || client.mailbox.readOnly !== true) {
        throw new Error('BACKUP_EMAIL_MAILBOX_NOT_READ_ONLY');
      }
      return await work();
    } finally {
      lock.release();
    }
  }
}

function toMessageMetadata(
  message: FetchMessageObject,
  mailbox: string,
  uidValidity: string,
): EmailMessageMetadata {
  if (
    !Number.isSafeInteger(message.uid) ||
    message.uid < 1 ||
    typeof message.size !== 'number' ||
    !Number.isSafeInteger(message.size) ||
    message.size < 1 ||
    message.size > maxEmailBytes
  ) {
    throw new Error('BACKUP_EMAIL_MESSAGE_SIZE_LIMIT_EXCEEDED');
  }
  const size = message.size;
  const flags = [...(message.flags ?? [])].sort().join(',');
  const internalDate =
    message.internalDate instanceof Date
      ? message.internalDate.toISOString()
      : typeof message.internalDate === 'string'
        ? message.internalDate
        : '';
  const subject = safeHeader(message.envelope?.subject, 180);
  const from = safeHeader(
    message.envelope?.from?.map((address) => address.address).join(', '),
    180,
  );
  const etag = createHash('sha256')
    .update(
      JSON.stringify({
        flags,
        internalDate,
        modseq: message.modseq?.toString() ?? '',
        size,
        uid: message.uid,
        uidValidity,
      }),
    )
    .digest('hex');
  return {
    etag,
    flags,
    from,
    internalDate,
    mailbox,
    size,
    subject,
    uid: message.uid,
    uidValidity,
  };
}

function emailObjectDescription(metadata: EmailMessageMetadata) {
  return {
    contentType: 'message/rfc822',
    etag: metadata.etag,
    metadata: {
      'email-flags': metadata.flags,
      'email-from': metadata.from,
      'email-internal-date': metadata.internalDate,
      'email-mailbox': metadata.mailbox,
      'email-subject': metadata.subject,
      'email-uid': String(metadata.uid),
      'email-uid-validity': metadata.uidValidity,
    },
    size: metadata.size,
  };
}

function emailMessageKey(mailbox: string, uidValidity: string, uid: number): string {
  return `mailboxes/${encodeURIComponent(mailbox)}/uidvalidity-${uidValidity}/${uid}.eml`;
}

function parseEmailMessageKey(key: string): { mailbox: string; uid: number; uidValidity: string } {
  const match = /^mailboxes\/([^/]+)\/uidvalidity-(\d+)\/(\d+)\.eml$/u.exec(key);
  if (!match?.[1] || !match[2] || !match[3]) throw new Error('BACKUP_EMAIL_MESSAGE_KEY_INVALID');
  let mailbox: string;
  try {
    mailbox = decodeURIComponent(match[1]);
  } catch {
    throw new Error('BACKUP_EMAIL_MESSAGE_KEY_INVALID');
  }
  const uidValidity = match[2];
  const uid = Number(match[3]);
  if (!mailbox || !Number.isSafeInteger(uid) || uid < 1) {
    throw new Error('BACKUP_EMAIL_MESSAGE_KEY_INVALID');
  }
  return { mailbox, uid, uidValidity };
}

function sameMessageMetadata(left: EmailMessageMetadata, right: EmailMessageMetadata): boolean {
  return (
    left.etag === right.etag &&
    left.size === right.size &&
    left.uidValidity === right.uidValidity &&
    left.uid === right.uid &&
    left.mailbox === right.mailbox
  );
}

function safeHeader(value: string | undefined, maxLength: number): string {
  const printable = Array.from(value ?? '', (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  }).join('');
  return printable.replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}
