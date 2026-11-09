import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { InvalidImageError } from '../errors';

const MAX_EDGE = 1280;
const JPEG_QUALITY = 70;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const PHOTO_FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;

export interface PreparedPhoto {
  buffer: Buffer;
  hash: string;
}

function storageRoot(): string {
  return resolve(process.env.PHOTO_STORAGE_DIR ?? 'uploads');
}

function reportsDirectory(): string {
  return resolve(storageRoot(), 'reports');
}

async function differenceHash(buffer: Buffer): Promise<string> {
  const raw = await sharp(buffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();

  let hash = '';
  for (let y = 0; y < 8; y += 1) {
    let byte = 0;
    for (let x = 0; x < 8; x += 1) {
      const left = raw[y * 9 + x] ?? 0;
      const right = raw[y * 9 + x + 1] ?? 0;
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hash += byte.toString(16).padStart(2, '0');
  }
  return hash;
}

/**
 * Normalise orientation, cap the long edge, re-encode as JPEG and compute a
 * perceptual hash used later for the 24-hour duplicate-photo check.
 */
export async function preparePhoto(buffer: Buffer): Promise<PreparedPhoto> {
  try {
    const pipeline = sharp(buffer, { failOn: 'error' }).rotate();
    const metadata = await pipeline.metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new InvalidImageError();
    }

    const compressed = await pipeline
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    return { buffer: compressed, hash: await differenceHash(compressed) };
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError();
  }
}

export async function saveReportPhoto(buffer: Buffer): Promise<string> {
  const filename = `${randomUUID()}.jpg`;
  const directory = reportsDirectory();
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, filename), buffer);
  return filename;
}

export async function deleteReportPhoto(filename: string): Promise<void> {
  if (!PHOTO_FILENAME_PATTERN.test(filename)) return;
  await rm(resolve(reportsDirectory(), filename), { force: true });
}

export function reportPhotoPath(filename: string): string {
  if (!PHOTO_FILENAME_PATTERN.test(filename)) {
    throw new InvalidImageError('Invalid photo filename');
  }
  const absolute = resolve(reportsDirectory(), filename);
  if (!absolute.startsWith(`${reportsDirectory()}${sep}`)) {
    throw new InvalidImageError('Invalid photo path');
  }
  return absolute;
}

export function isValidPhotoFilename(filename: string): boolean {
  return PHOTO_FILENAME_PATTERN.test(filename);
}
