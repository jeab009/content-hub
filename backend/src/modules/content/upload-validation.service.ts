import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface AllowedMimeSpec {
  mimeType: string;
  extension: string;
  category: 'image' | 'video';
}

export class UnsupportedFileTypeError extends Error {}
export class FileTooLargeError extends Error {}

/**
 * Server-side allow-list of accepted upload types (security condition #1).
 * Intentionally small — this is a social-content CMS, not a general file
 * store: JPEG/PNG cover the image case, MP4 covers video. Client-supplied
 * Content-Type and filename extension are NEVER trusted; the MIME type used
 * everywhere downstream (DB column, response, storage extension) comes only
 * from sniffing the file's actual magic bytes below.
 */
const ALLOWED_TYPES: AllowedMimeSpec[] = [
  { mimeType: 'image/jpeg', extension: 'jpg', category: 'image' },
  { mimeType: 'image/png', extension: 'png', category: 'image' },
  { mimeType: 'video/mp4', extension: 'mp4', category: 'video' },
];

/**
 * Detects the true file type from its binary signature ("magic bytes"),
 * not from client-supplied Content-Type or filename extension, both of
 * which are trivially spoofable. Implemented by hand (no external
 * dependency) — the three signatures needed here are small, stable, and
 * well documented, and skipping a dependency avoids ESM/CJS friction in a
 * CommonJS NestJS build.
 */
export function sniffMimeType(buffer: Buffer): AllowedMimeSpec | null {
  if (isJpeg(buffer)) return ALLOWED_TYPES[0];
  if (isPng(buffer)) return ALLOWED_TYPES[1];
  if (isMp4(buffer)) return ALLOWED_TYPES[2];
  return null;
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

/**
 * MP4 (ISO Base Media File Format) files start with a 4-byte box size
 * followed by the ASCII box type. The first box is virtually always
 * `ftyp` at byte offset 4, regardless of the exact size value, so checking
 * bytes[4..8] === "ftyp" is the standard sniff used by most MIME-detection
 * libraries for this family of formats.
 */
function isMp4(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

@Injectable()
export class UploadValidationService {
  private readonly maxImageBytes: number;
  private readonly maxVideoBytes: number;

  constructor(configService: ConfigService) {
    const appConfig = configService.get<AppConfig>('app');
    if (!appConfig) {
      throw new Error('App config not loaded');
    }
    this.maxImageBytes = appConfig.upload.maxImageBytes;
    this.maxVideoBytes = appConfig.upload.maxVideoBytes;
  }

  /**
   * Validates a fully-buffered upload: sniffs the real type, rejects
   * anything off the allow-list, and enforces the per-category size ceiling.
   * The multipart parser (see content.controller.ts's FileInterceptor
   * limits) already caps the raw stream at the larger of the two ceilings
   * before this method ever runs, so a maximally-oversized non-matching
   * upload never gets fully buffered in memory in the first place.
   */
  validate(buffer: Buffer): AllowedMimeSpec {
    const detected = sniffMimeType(buffer);
    if (!detected) {
      throw new UnsupportedFileTypeError(
        'Unsupported or unrecognized file type. Allowed: JPEG, PNG, MP4.',
      );
    }

    const limit = detected.category === 'image' ? this.maxImageBytes : this.maxVideoBytes;
    if (buffer.length > limit) {
      throw new FileTooLargeError(
        `File exceeds the ${detected.category} size limit of ${limit} bytes.`,
      );
    }

    return detected;
  }

  get streamLevelMaxBytes(): number {
    return Math.max(this.maxImageBytes, this.maxVideoBytes);
  }
}
