/**
 * Regression test for BUG-P6-01 (DevOps DEVOPS-1 / QA P6-OBS-2).
 *
 * The e2e harness truncates every application table. Before this test existed,
 * its safety guard validated only the HOST of `DATABASE_URL`, so the persistent
 * Docker compose demo database (`postgres://…@localhost:5432/content_hub`) was
 * indistinguishable from a throwaway CI database — and QA lost the seeded demo
 * data to exactly that. These cases pin the guard to the database NAME.
 *
 * This spec deliberately touches no database: `assertDisposableDatabase` is a
 * pure function, so it belongs in the fast unit suite, where the guard is
 * exercised on every run rather than only when someone runs `test:e2e`.
 */

import { E2E_TRUNCATE_OVERRIDE_ENV, assertDisposableDatabase } from './e2e-database';

const CI_E2E_URL =
  'postgresql://content_hub:content_hub@localhost:5432/content_hub_e2e?schema=public';
const DEMO_URL = 'postgresql://content_hub:content_hub@localhost:5432/content_hub?schema=public';

describe('assertDisposableDatabase', () => {
  const noOverride: NodeJS.ProcessEnv = {};

  it('accepts the CI e2e database', () => {
    expect(assertDisposableDatabase(CI_E2E_URL, noOverride)).toBe(CI_E2E_URL);
  });

  it('accepts a bare "e2e" database name and the in-container postgres host', () => {
    const url = 'postgresql://content_hub:content_hub@postgres:5432/e2e';
    expect(assertDisposableDatabase(url, noOverride)).toBe(url);
  });

  it('REFUSES the persistent Docker compose demo database (the P6-OBS-2 data loss)', () => {
    expect(() => assertDisposableDatabase(DEMO_URL, noOverride)).toThrow(
      /Refusing to run the e2e suite against database "content_hub"/,
    );
  });

  it('refuses a name that merely contains "e2e" without ending in it', () => {
    const url = 'postgresql://content_hub:content_hub@127.0.0.1:5432/e2e_content_hub';
    expect(() => assertDisposableDatabase(url, noOverride)).toThrow(/does not end in "e2e"/);
  });

  it('refuses a URL with no database name at all', () => {
    const url = 'postgresql://content_hub:content_hub@localhost:5432';
    expect(() => assertDisposableDatabase(url, noOverride)).toThrow(/\(unnamed\)/);
  });

  it('still refuses a non-local host before the name is ever considered', () => {
    const url = 'postgresql://u:p@db.staging.internal:5432/content_hub_e2e';
    expect(() => assertDisposableDatabase(url, noOverride)).toThrow(
      /does not point at localhost\/127\.0\.0\.1\/postgres/,
    );
  });

  it('refuses a missing DATABASE_URL', () => {
    expect(() => assertDisposableDatabase(undefined, noOverride)).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it('allows a deliberately-overridden non-e2e name', () => {
    expect(assertDisposableDatabase(DEMO_URL, { [E2E_TRUNCATE_OVERRIDE_ENV]: '1' })).toBe(DEMO_URL);
  });

  it('does not treat an arbitrary override value as consent', () => {
    expect(() => assertDisposableDatabase(DEMO_URL, { [E2E_TRUNCATE_OVERRIDE_ENV]: '0' })).toThrow(
      /Refusing to run the e2e suite against database/,
    );
  });

  it('does not let the override bypass the host check', () => {
    expect(() =>
      assertDisposableDatabase('postgresql://u:p@prod.example.com:5432/anything', {
        [E2E_TRUNCATE_OVERRIDE_ENV]: '1',
      }),
    ).toThrow(/does not point at localhost/);
  });
});
