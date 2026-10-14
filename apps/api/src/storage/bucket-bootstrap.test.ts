import {
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { ensurePrivateBucket, type BucketBootstrapCommand } from './bucket-bootstrap.js';

describe('private object-storage bucket bootstrap', () => {
  it('creates a missing bucket, verifies it, and removes anonymous policy', async () => {
    const missing = Object.assign(new Error('missing'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    const commands: BucketBootstrapCommand[] = [];
    const send = vi.fn((command: BucketBootstrapCommand): Promise<unknown> => {
      commands.push(command);
      return commands.length === 1 ? Promise.reject(missing) : Promise.resolve({});
    });

    await ensurePrivateBucket({ send }, 'vista-files', 'us-east-1', 1_000);

    expect(commands.map((command) => command.constructor)).toEqual([
      HeadBucketCommand,
      CreateBucketCommand,
      HeadBucketCommand,
      DeleteBucketPolicyCommand,
    ]);
    const create = commands.find(
      (command): command is CreateBucketCommand => command instanceof CreateBucketCommand,
    );
    expect(create?.input).toEqual({ Bucket: 'vista-files' });
  });

  it('keeps an existing bucket, removes any public policy, and tolerates no policy', async () => {
    const noPolicy = Object.assign(new Error('no bucket policy'), {
      name: 'NoSuchBucketPolicy',
      $metadata: { httpStatusCode: 404 },
    });
    const commands: BucketBootstrapCommand[] = [];
    const send = vi.fn((command: BucketBootstrapCommand): Promise<unknown> => {
      commands.push(command);
      return commands.length === 2 ? Promise.reject(noPolicy) : Promise.resolve({});
    });

    await expect(
      ensurePrivateBucket({ send }, 'vista-files', 'us-east-1', 1_000),
    ).resolves.toBeUndefined();

    expect(commands.map((command) => command.constructor)).toEqual([
      HeadBucketCommand,
      DeleteBucketPolicyCommand,
    ]);
  });

  it('uses the configured region for buckets outside us-east-1', async () => {
    const missing = Object.assign(new Error('missing'), {
      name: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    });
    const commands: BucketBootstrapCommand[] = [];
    const send = vi.fn((command: BucketBootstrapCommand): Promise<unknown> => {
      commands.push(command);
      return commands.length === 1 ? Promise.reject(missing) : Promise.resolve({});
    });

    await ensurePrivateBucket({ send }, 'vista-files', 'eu-central-1', 1_000);

    const create = commands.find(
      (command): command is CreateBucketCommand => command instanceof CreateBucketCommand,
    );
    expect(create?.input).toEqual({
      Bucket: 'vista-files',
      CreateBucketConfiguration: { LocationConstraint: 'eu-central-1' },
    });
  });
});
