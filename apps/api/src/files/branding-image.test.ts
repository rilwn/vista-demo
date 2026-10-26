import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { validateBrandingImage } from './branding-image.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQt9D/DwACZgF+JMBukQAAAABJRU5ErkJggg==',
  'base64',
);

describe('financial document image validation', () => {
  it('accepts a small, decodable PNG', async () => {
    await expect(validateBrandingImage(png, 'image/png')).resolves.toBeUndefined();
  });
  it('rejects invalid, mismatched, truncated and oversized images', async () => {
    for (const [bytes, type] of [
      [Buffer.from('not an image'), 'image/png'],
      [png, 'image/jpeg'],
      [png.subarray(0, 40), 'image/png'],
      [Buffer.alloc(524289), 'image/png'],
    ] as const)
      await expect(validateBrandingImage(bytes, type)).rejects.toMatchObject({
        response: { code: 'FINANCE_BRANDING_IMAGE_INVALID' },
      });
  });
  it('bounds decoded dimensions and refuses interlaced or invalid scanlines before asynchronous decoding', async () => {
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(3000, 16);
    const interlaced = Buffer.from(png);
    interlaced[28] = 1;
    const badFilter = pngWithData(Buffer.from([5, 0, 0, 0, 0]));
    const bomb = pngWithData(Buffer.alloc(100000));
    for (const bytes of [oversized, interlaced, badFilter, bomb])
      await expect(validateBrandingImage(bytes, 'image/png')).rejects.toMatchObject({
        response: { code: 'FINANCE_BRANDING_IMAGE_INVALID' },
      });
  });
});

function pngWithData(data: Buffer) {
  const compressed = deflateSync(data);
  const chunk = Buffer.alloc(12 + compressed.length);
  chunk.writeUInt32BE(compressed.length, 0);
  chunk.write('IDAT', 4, 'ascii');
  compressed.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + compressed.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + compressed.length);
  // The decoder is never reached: scanline/filter validation must reject these inputs first.
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(png.length - 12)]);
}
