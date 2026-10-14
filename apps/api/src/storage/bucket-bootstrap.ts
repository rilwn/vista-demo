import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

export type BucketBootstrapCommand =
  CreateBucketCommand | DeleteBucketPolicyCommand | HeadBucketCommand;

export type BucketBootstrapClient = {
  send(command: BucketBootstrapCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
};

function errorDetails(error: unknown): { code?: string; status?: number } {
  if (!error || typeof error !== 'object') return {};
  const value = error as {
    Code?: unknown;
    code?: unknown;
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const code = [value.name, value.Code, value.code].find(
    (candidate): candidate is string => typeof candidate === 'string',
  );
  return {
    ...(code ? { code } : {}),
    ...(typeof value.$metadata?.httpStatusCode === 'number'
      ? { status: value.$metadata.httpStatusCode }
      : {}),
  };
}

export async function ensurePrivateBucket(
  client: BucketBootstrapClient,
  bucket: string,
  region: string,
  timeoutMs: number,
): Promise<void> {
  const options = () => ({ abortSignal: AbortSignal.timeout(timeoutMs) });
  let exists = false;

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), options());
    exists = true;
  } catch (error) {
    const details = errorDetails(error);
    if (details.status !== 404 && details.code !== 'NotFound' && details.code !== 'NoSuchBucket') {
      throw error;
    }
  }

  if (!exists) {
    try {
      await client.send(
        new CreateBucketCommand({
          Bucket: bucket,
          ...(region === 'us-east-1'
            ? {}
            : {
                CreateBucketConfiguration: {
                  LocationConstraint: region as BucketLocationConstraint,
                },
              }),
        }),
        options(),
      );
    } catch (error) {
      const details = errorDetails(error);
      if (details.code !== 'BucketAlreadyOwnedByYou' && details.code !== 'BucketAlreadyExists') {
        throw error;
      }
    }
    await client.send(new HeadBucketCommand({ Bucket: bucket }), options());
  }

  try {
    await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }), options());
  } catch (error) {
    const details = errorDetails(error);
    if (details.status !== 404 && details.code !== 'NoSuchBucketPolicy') throw error;
  }
}
