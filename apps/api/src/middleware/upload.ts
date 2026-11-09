import multer from 'multer';
import { ApiError } from '../errors';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

/**
 * Keeps the upload in memory so it can be validated, compressed and hashed
 * before anything touches the disk. The cap mirrors the client-side limit.
 */
export const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PHOTO_BYTES,
    files: 1,
    fields: 12,
  },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      callback(
        new ApiError(
          415,
          'Only JPEG, PNG or WebP photos are accepted',
          'unsupported_media_type',
        ),
      );
      return;
    }
    callback(null, true);
  },
}).single('photo');

export const MAX_PHOTO_SIZE_BYTES = MAX_PHOTO_BYTES;
