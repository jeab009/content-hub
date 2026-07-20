import { UnprocessableEntityException } from '@nestjs/common';
import { CommerceChannel } from '@prisma/client';
import { assertShopeeDuration } from './commerce-duration';

describe('assertShopeeDuration', () => {
  it('passes for a non-shopee channel regardless of duration', () => {
    expect(() => assertShopeeDuration(CommerceChannel.tiktok_shop, null)).not.toThrow();
    expect(() => assertShopeeDuration(CommerceChannel.tiktok_shop, undefined)).not.toThrow();
    expect(() => assertShopeeDuration(CommerceChannel.tiktok_shop, 5)).not.toThrow();
  });

  it('rejects null/undefined for shopee — null is a rejection, not a pass (422)', () => {
    expect(() => assertShopeeDuration(CommerceChannel.shopee, null)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertShopeeDuration(CommerceChannel.shopee, undefined)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects below the 10s floor and above the 60s ceiling', () => {
    expect(() => assertShopeeDuration(CommerceChannel.shopee, 9)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertShopeeDuration(CommerceChannel.shopee, 61)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('accepts the boundary values 10, 42, and 60', () => {
    expect(() => assertShopeeDuration(CommerceChannel.shopee, 10)).not.toThrow();
    expect(() => assertShopeeDuration(CommerceChannel.shopee, 42)).not.toThrow();
    expect(() => assertShopeeDuration(CommerceChannel.shopee, 60)).not.toThrow();
  });
});
