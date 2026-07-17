import { BadRequestException } from '@nestjs/common';

/**
 * Shape of every mediaUrl this system mints: the upload endpoint
 * (POST /api/contents/upload) is the only place mediaUrl values are created
 * (local disk adapter returns `/uploads/<uuid>.<ext>`), so this is the only
 * shape ContentService / ContentAssetService will accept.
 */
const OWNED_MEDIA_URL_PATTERN = /^\/uploads\/[a-f0-9-]{36}\.(jpg|png|mp4)$/;

/**
 * Content and content-asset creation only accept a mediaUrl that matches the
 * storage adapter's own output shape — never an arbitrary client-supplied
 * external URL — so these endpoints can't be used as an open redirect /
 * SSRF-adjacent primitive for referencing attacker-hosted content as if it
 * were locally stored.
 */
export function assertMediaUrlIsOwned(mediaUrl: string): void {
  if (!OWNED_MEDIA_URL_PATTERN.test(mediaUrl)) {
    throw new BadRequestException(
      'mediaUrl must reference a file previously returned by POST /api/contents/upload',
    );
  }
}
