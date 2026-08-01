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
 * to be careful — the database NAME must end in `e2e` (see
 * `assertDisposableDatabase`), or `ALLOW_E2E_TRUNCATE=1` must be set.
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
  // Phase 7 — paid/ads visibility. Children before parent: entries reference
  // campaigns (RESTRICT) and themselves via corrects_entry_id (self-FK,
  // SET NULL); campaigns reference contents (SET NULL) and users (RESTRICT).
  // A single TRUNCATE ... CASCADE statement resolves these regardless of
  // list order, but the order is kept honest here for the same documentation
  // reason the commerce block above is ordered.
  'ad_performance_entries',
  'ad_campaigns',
  'comments',
  'comment_reply_templates',
  'escalation_alerts',
  // Found by the leftover check the moment it was implemented, and these two
  // are the reason it was worth implementing: RankingFactorsService reads BOTH
  // (`pillar_alignment` and `cadence_pressure`), and the payout fixture seeds
  // neither — so whatever a previous run happened to leave behind was silently
  // feeding the re-rank inside the byte-identity proof.
  'pillar_ratio_policies',
  'platform_cadence_targets',
  'metrics',
  'posts',
  'ranking_scores',
  'content_assets',
  'contents',
  'audit_logs',
  'connected_accounts',
  'users',
] as const;

/** Opt-out hatch for a database that is disposable but not named like it. */
export const E2E_TRUNCATE_OVERRIDE_ENV = 'ALLOW_E2E_TRUNCATE';

/** A database name is accepted when it ends in `e2e`, optionally `_`-separated. */
const DISPOSABLE_DB_NAME = /(^|_)e2e$/;

/**
 * Extracts the database name from a Postgres connection URL.
 *
 * `new URL()` cannot be given a `postgresql:` URL and asked for `pathname`
 * reliably across Node versions, so the scheme is rewritten to `http:` purely
 * for parsing. Returns `''` when the URL has no path component, which the
 * caller treats as "not disposable".
 */
function databaseNameOf(url: string): string {
  try {
    const parsed = new URL(url.replace(/^[a-z+]+:/i, 'http:'));
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

/**
 * Refuses any database that is not obviously disposable.
 *
 * TWO CHECKS, AND THE SECOND ONE IS THE LOAD-BEARING ONE (BUG-P6-01).
 *
 * The original guard checked only the HOST (`localhost`/`127.0.0.1`/`postgres`).
 * That is not a disposability test at all: the Docker compose demo stack is
 * reachable at exactly those hosts, and its database is named `content_hub` —
 * so the guard waved through the persistent demo database as readily as a
 * throwaway CI one, and `resetDatabase()` truncated it. QA hit this for real
 * (P6-OBS-2) and lost the seeded demo data.
 *
 * The host check is kept (it still stops a staging/production URL pasted into
 * `.env`), but the decision now rests on the database NAME: it must end in
 * `e2e` — a name a human had to deliberately create for this purpose, e.g.
 * CI's `content_hub_e2e`. A developer who genuinely wants to truncate a
 * differently-named disposable database sets `ALLOW_E2E_TRUNCATE=1` and owns
 * that choice explicitly.
 */
export function assertDisposableDatabase(
  url: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
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

  const dbName = databaseNameOf(url);
  if (DISPOSABLE_DB_NAME.test(dbName)) {
    return url;
  }

  // QA-2: the override used to be a boolean checked BEFORE the name check, so
  // `ALLOW_E2E_TRUNCATE=1` waved through `localhost/content_hub` — one env var
  // away from wiping the demo database, which is the failure the name check
  // exists to prevent. It now has to NAME the database it is willing to lose,
  // so it cannot be set once and forgotten while DATABASE_URL moves underneath
  // it.
  const override = env[E2E_TRUNCATE_OVERRIDE_ENV];
  if (override && override === dbName) {
    return url;
  }

  throw new Error(
    `Refusing to run the e2e suite against database "${dbName || '(unnamed)'}": its name does not ` +
      'end in "e2e". This suite TRUNCATES every application table, including users, contents and ' +
      'posts — running it against the Docker compose demo database erases the demo data. ' +
      'Point DATABASE_URL at a disposable database whose name says so (e.g. content_hub_e2e), ' +
      `or set ${E2E_TRUNCATE_OVERRIDE_ENV}="${dbName}" to name the database you accept losing ` +
      '(a bare "1" is deliberately not accepted).',
  );
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

  // The guard the TRUNCATE_ORDER docblock promises (QC MINOR-1: it was
  // described but never implemented).
  //
  // Add a table in a later migration, forget to list it above, and every
  // fixture silently inherits the previous run's rows — the byte-identity
  // proof would then compare two dirty states and pass for the wrong reason.
  // Asking the database which tables exist, rather than trusting the list,
  // is the only version of this check that can catch its own omission.
  const leftovers = await prisma.$queryRaw<Array<{ table_name: string; n: bigint }>>`
    SELECT c.relname AS table_name, c.reltuples::bigint AS n
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE '\\_prisma%'
      AND c.relname <> ALL (${Prisma.sql`ARRAY[${Prisma.join(TRUNCATE_ORDER.map((t) => t))}]::text[]`})
  `;

  if (leftovers.length > 0) {
    const names = leftovers.map((row) => row.table_name).sort();
    throw new Error(
      `resetDatabase truncated ${TRUNCATE_ORDER.length} tables but the schema also contains: ` +
        `${names.join(', ')}. Add them to TRUNCATE_ORDER (children before parents) — an untruncated ` +
        'table leaks rows between e2e runs, which makes the byte-identity proof compare two dirty ' +
        'states and pass for the wrong reason.',
    );
  }
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

/**
 * Phase 7 sibling of `assertCommerceSchemaPresent` — asserts the paid
 * migration is actually applied, converting the most likely setup mistake
 * (forgetting `prisma migrate deploy` after pulling this phase's migration)
 * into a sentence rather than an opaque Prisma error from the fixture.
 */
export async function assertPaidSchemaPresent(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('ad_campaigns', 'ad_performance_entries')
  `;

  if (rows.length !== 2) {
    const found =
      rows
        .map((row) => row.table_name)
        .sort()
        .join(', ') || '(none)';
    throw new Error(
      `The Phase 7 paid migration is not applied to this database. Found: ${found}. ` +
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
