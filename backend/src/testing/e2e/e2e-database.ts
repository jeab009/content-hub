/**
 * WP 6.0.8 — real-database harness for the e2e suite.
 *
 * WHY THIS IS ITS OWN WORK PACKAGE (System Analyst condition B2)
 * -------------------------------------------------------------
 * All 39 pre-Phase-6 specs are unit-style with a mocked `PrismaService`;
 * `grep -rl "new PrismaClient" src` returned nothing. This project had never
 * had a test that touches a real database. The byte-identity proof (exit
 * criterion #6) is therefore new INFRASTRUCTURE, not a new test, and the plan
 * originally sized it as one line item inside 6.0.7 alongside four others.
 *
 * The infrastructure cost is genuinely small, because `.github/workflows/ci.yml`
 * already provisions `postgres:16-alpine` and `redis:7-alpine`, sets
 * `DATABASE_URL`, and runs `npx prisma migrate deploy`. What was missing was a
 * second jest project (jest.e2e.config.js), the deterministic fixtures beside
 * this file, and a CI job.
 *
 * SAFETY
 * ------
 * This module TRUNCATES every application table. It refuses to run against a
 * database whose URL does not look like a disposable test/CI database, because
 * the cost of being wrong once is the developer's local data. The check is
 * deliberately conservative: opt in by naming your database, not by remembering
 * to be careful.
 */

import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Tables truncated between runs, children before parents.
 *
 * `RESTART IDENTITY CASCADE` would make the order irrelevant, but listing it
 * explicitly documents the FK topology — including the four hand-written FKs
 * from commerce into `posts` / `contents` / `content_assets` / `users` that
 * Prisma's type graph deliberately cannot see (design §2.1). If a future
 * commerce table is added and not listed here, the fixture stops being
 * deterministic; that is what the row-count assertion in `resetDatabase`
 * guards.
 */
const TRUNCATE_ORDER = [
  'commerce_conversions',
  'product_anchors',
  'affiliate_links',
  'commerce_placements',
  'commerce_products',
  'comments',
  'metrics',
  'posts',
  'ranking_scores',
  'content_assets',
  'contents',
  'audit_logs',
  'connected_accounts',
  'users',
] as const;

/**
 * Refuses any database that is not obviously disposable.
 *
 * CI uses `content_hub` on localhost, and a developer running this locally
 * points at the Docker compose database. Both are named below. Anything else
 * — a staging URL pasted into `.env`, a production URL — throws before a
 * single statement runs.
 */
function assertDisposableDatabase(url: string | undefined): string {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The e2e suite needs a migrated, disposable database.',
    );
  }

  const isLocal = /@(localhost|127\.0\.0\.1|postgres):/.test(url);
  if (!isLocal) {
    throw new Error(
      'Refusing to run the e2e suite: DATABASE_URL does not point at localhost/127.0.0.1/postgres. ' +
        'This suite TRUNCATES every table. Point it at the CI database or the Docker compose one.',
    );
  }

  return url;
}

/** A connected client for the e2e suite. Callers must `$disconnect()`. */
export function createE2eClient(): PrismaClient {
  const url = assertDisposableDatabase(process.env.DATABASE_URL);
  return new PrismaClient({ datasources: { db: { url } } });
}

/**
 * Empties every application table.
 *
 * Uses `$executeRaw` with `Prisma.raw` over a hardcoded constant list — never
 * `$executeRawUnsafe`, which is banned repo-wide by the ESLint
 * `no-restricted-syntax` rule (security decision #5). No value here comes from
 * outside this file, so there is no injection surface.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = TRUNCATE_ORDER.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRaw`${Prisma.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`)}`;
}

/**
 * Asserts the migration under test is actually applied.
 *
 * Without this, a developer running against a stale database sees the commerce
 * fixture fail with an opaque Prisma error rather than "you have not run
 * `prisma migrate deploy`". Cheap, and it converts the single most likely
 * setup mistake into a sentence.
 */
export async function assertCommerceSchemaPresent(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'commerce_products', 'affiliate_links', 'product_anchors',
        'commerce_placements', 'commerce_conversions'
      )
  `;

  if (rows.length !== 5) {
    const found =
      rows
        .map((row) => row.table_name)
        .sort()
        .join(', ') || '(none)';
    throw new Error(
      `The Phase 6 commerce migration is not applied to this database. Found: ${found}. ` +
        'Run `npx prisma migrate deploy` first.',
    );
  }
}

/** Physical column names of a table, in ordinal position — for the allow-list check. */
export async function columnsOfTable(prisma: PrismaClient, table: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;

  return rows.map((row) => row.column_name);
}
