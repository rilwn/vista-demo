import PDFDocument from 'pdfkit';
import { inflateSync } from 'node:zlib';
import { ApiErrorException } from '../common/api-error.exception.js';

/** Reject oversized/decompression-bomb images before the PDF image decoder runs. */
export async function validateBrandingImage(buffer: Buffer, mediaType: string): Promise<void> {
  let width = 0;
  let height = 0;
  if (buffer.length > 512 * 1024) throw invalid('Keep each image below 512 KB.');
  if (
    mediaType === 'image/png' &&
    buffer.length >= 33 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (mediaType === 'image/jpeg' && buffer[0] === 255 && buffer[1] === 216) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 255) break;
      while (buffer[offset] === 255) offset++;
      const marker = buffer[offset++];
      if (marker === undefined || marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) {
        height = buffer.readUInt16BE(offset + 3);
        width = buffer.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height || width > 2048 || height > 2048 || width * height > 2_000_000)
    throw invalid(
      'Choose a valid PNG or JPEG image up to 2048 pixels per side and two megapixels.',
    );
  if (mediaType === 'image/png') validatePngData(buffer, width, height);
  try {
    const pdf = new PDFDocument();
    pdf.on('data', () => undefined);
    const complete = new Promise<void>((resolve, reject) => {
      pdf.on('end', resolve);
      pdf.on('error', reject);
    });
    pdf.image(buffer, 0, 0, { fit: [1, 1] });
    pdf.end();
    await complete;
  } catch {
    throw invalid('This image cannot be opened. Choose a valid PNG or JPEG image.');
  }
}
function validatePngData(buffer: Buffer, width: number, height: number) {
  // PNG-JS reports malformed scanline filters from an asynchronous callback.
  // Validate them synchronously before handing untrusted bytes to PDFKit.
  try {
    if (buffer[26] !== 0 || buffer[27] !== 0 || buffer[28] !== 0)
      throw new Error('Use a non-interlaced PNG or JPEG.');
    const colors = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[buffer[25]!];
    const bits = buffer[24]!;
    const allowedBits = (
      { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] } as Record<
        number,
        number[]
      >
    )[buffer[25]!];
    if (!colors || !allowedBits?.includes(bits)) throw new Error('Unsupported PNG.');
    const parts: Buffer[] = [];
    let offset = 8;
    let ended = false;
    let palette = false;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      if (length > buffer.length - offset - 12) throw new Error('Truncated PNG.');
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (
        !/^[A-Za-z]{4}$/.test(type) ||
        crc32(buffer.subarray(offset + 4, offset + 8 + length)) !==
          buffer.readUInt32BE(offset + 8 + length)
      )
        throw new Error('Corrupt PNG chunk.');
      if (type === 'IHDR' && (offset !== 8 || length !== 13))
        throw new Error('Invalid image header.');
      if (offset === 8 && type !== 'IHDR') throw new Error('Missing image header.');
      if (type === 'PLTE') {
        if (palette || !length || length > 768 || length % 3 !== 0)
          throw new Error('Invalid palette.');
        palette = true;
      }
      if (type[0] === type[0]!.toUpperCase() && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type))
        throw new Error('Unsupported image chunk.');
      if (type === 'IDAT') parts.push(buffer.subarray(offset + 8, offset + 8 + length));
      if (type === 'IEND') {
        if (length !== 0 || offset + 12 !== buffer.length) throw new Error('Invalid end of image.');
        ended = true;
        break;
      }
      offset += length + 12;
    }
    const stride = 1 + Math.ceil((width * colors * bits) / 8);
    const data = inflateSync(Buffer.concat(parts), { maxOutputLength: stride * height });
    if (!ended || (buffer[25] === 3 && !palette) || data.length !== stride * height)
      throw new Error('Incomplete PNG.');
    for (let y = 0; y < height; y++) if (data[y * stride]! > 4) throw new Error('Invalid filter.');
  } catch {
    throw invalid('Re-save this image as a standard non-interlaced PNG or JPEG and try again.');
  }
}
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function invalid(message: string) {
  return new ApiErrorException('FINANCE_BRANDING_IMAGE_INVALID', message, 400);
}
