import { UnprocessableEntityException } from '@nestjs/common';
import { CommerceChannel } from '@prisma/client';
import { SHOPEE_DURATION_MAX_SECONDS, SHOPEE_DURATION_MIN_SECONDS } from './commerce.constants';

/**
 * Layer 2 of the three duration layers (architecture §3.6) — the PLACEMENT
 * BOUNDARY, fail-closed. Layer 1 (upload capture, `mp4-duration.ts`) is
 * best-effort and never blocks; layer 3 (browser) is a courtesy only. This
 * is the one that is authoritative.
 *
 * `channel !== shopee` → pass (no other channel is duration-gated today).
 * `durationSeconds == null` → 422. NULL IS A REJECTION, not a pass — the
 * DB CHECK backing this (`commerce_placements_shopee_duration_chk`) had to
 * spell out the same rule explicitly, because the naive
 * `channel <> 'shopee' OR duration_seconds BETWEEN 10 AND 60` form silently
 * ACCEPTS a NULL duration in Postgres (`FALSE OR NULL` = `NULL`, and a CHECK
 * treats NULL as "not violated"). This function is the service-layer mirror
 * of that same care.
 */
export function assertShopeeDuration(
  channel: CommerceChannel,
  durationSeconds: number | null | undefined,
): void {
  if (channel !== CommerceChannel.shopee) {
    return;
  }

  if (durationSeconds === null || durationSeconds === undefined) {
    throw new UnprocessableEntityException(
      `Shopee placements require a video duration between ${SHOPEE_DURATION_MIN_SECONDS} and ` +
        `${SHOPEE_DURATION_MAX_SECONDS} seconds. None was provided or could be parsed from the ` +
        'source asset — enter it by hand.',
    );
  }

  if (
    durationSeconds < SHOPEE_DURATION_MIN_SECONDS ||
    durationSeconds > SHOPEE_DURATION_MAX_SECONDS
  ) {
    throw new UnprocessableEntityException(
      `Shopee placements require a video duration between ${SHOPEE_DURATION_MIN_SECONDS} and ` +
        `${SHOPEE_DURATION_MAX_SECONDS} seconds; got ${durationSeconds}.`,
    );
  }
}
