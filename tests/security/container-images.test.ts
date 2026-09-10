import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageMatrix, discoverImages } from './container-images.js';

void test('deduplicates Compose references and gives each image a safe artifact name', () => {
  assert.deepEqual(
    imageMatrix(['redis:7.4.5-alpine\npostgres:16.9-alpine\n', 'redis:7.4.5-alpine']),
    {
      include: [
        { image: 'postgres:16.9-alpine', artifact: 'container-1' },
        { image: 'redis:7.4.5-alpine', artifact: 'container-2' },
      ],
    },
  );
});
void test('rejects empty inventory instead of silently skipping scans', () => {
  for (const outputs of [[], [''], ['redis:7', '   ']]) assert.throws(() => imageMatrix(outputs));
});
void test('rejects floating, interpolated and unsafe references', () => {
  for (const image of [
    'redis',
    'redis:latest',
    '${IMAGE}',
    'redis:7;echo',
    '--help',
    'redis:7\n$(id)',
  ])
    assert.throws(() => imageMatrix([image]));
});
void test('accepts digest-pinned images', () => {
  const image = `ghcr.io/example/image@sha256:${'a'.repeat(64)}`;
  assert.equal(imageMatrix([image]).include[0]?.image, image);
});
void test('real Compose files produce a nonempty distinct scan matrix without starting services', () => {
  const { include } = discoverImages();
  assert.ok(include.length >= 5);
  assert.equal(new Set(include.map((entry) => entry.image)).size, include.length);
});
