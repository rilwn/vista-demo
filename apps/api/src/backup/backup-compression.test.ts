import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';

import {
  backupCompressionAlgorithm,
  createBackupCompressor,
  createBackupDecompressor,
  createUncompressedSizeGuard,
} from './backup-compression.js';

describe('backup compression', () => {
  it('maps the approved source and policy setting to a stable artifact format', () => {
    expect(
      backupCompressionAlgorithm(
        'database',
        true,
        'postgresql://backup:secret@db.example.invalid/vista',
      ),
    ).toBe('postgres_custom');
    expect(
      backupCompressionAlgorithm(
        'database',
        true,
        'mysql://backup:secret@db.example.invalid/vista',
      ),
    ).toBe('gzip');
    expect(backupCompressionAlgorithm('database', false)).toBe('none');
    expect(backupCompressionAlgorithm('object_storage', true)).toBe('gzip');
    expect(backupCompressionAlgorithm('object_storage', false)).toBe('none');
  });

  it('round trips compressed bytes while enforcing the recorded original size', async () => {
    const original = Buffer.from('Vista recovery data '.repeat(500));
    const compressed = await collect(
      Readable.from([original]).pipe(createBackupCompressor('gzip')!),
    );
    const restored: Buffer[] = [];
    await pipeline(
      Readable.from([compressed]),
      createBackupDecompressor('gzip')!,
      createUncompressedSizeGuard(String(original.length)),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          restored.push(Buffer.from(chunk));
          callback();
        },
      }),
    );
    expect(Buffer.concat(restored)).toEqual(original);
    expect(compressed.length).toBeLessThan(original.length);
  });

  it('rejects compressed data that expands beyond its recorded size', async () => {
    const compressed = await collect(
      Readable.from([Buffer.from('too much data')]).pipe(createBackupCompressor('gzip')!),
    );
    await expect(
      pipeline(
        Readable.from([compressed]),
        createBackupDecompressor('gzip')!,
        createUncompressedSizeGuard('3'),
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      ),
    ).rejects.toThrow('BACKUP_UNCOMPRESSED_SIZE_EXCEEDED');
  });

  it('rejects truncated output that does not match its recorded size', async () => {
    const compressed = await collect(
      Readable.from([Buffer.from('short')]).pipe(createBackupCompressor('gzip')!),
    );
    await expect(
      pipeline(
        Readable.from([compressed]),
        createBackupDecompressor('gzip')!,
        createUncompressedSizeGuard('100'),
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      ),
    ).rejects.toThrow('BACKUP_UNCOMPRESSED_SIZE_MISMATCH');
  });
});

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
