/**
 * WBS 7D.2 structural proof: no live HTTP client code exists anywhere under
 * `src/modules/paid/`, and no reference to the Meta Ads MCP exists anywhere
 * in application source. Mirrors the existing boundary-scan style
 * (`commerce-boundary.spec.ts`) rather than inventing a second scanning
 * idiom — Commerce's own 6D contract spec proves "zero I/O" per-instance via
 * a `fetch` spy (see `paid-live.adapter.spec.ts` for the equivalent Paid
 * check), but has no repo-wide grep for the absence of HTTP-client code, so
 * this file is genuinely new coverage, not a duplicate of an existing test.
 * It fits the codebase's existing test style directly: the token-scan
 * utility (`../source-scan.util.ts`) already exists for exactly this shape
 * of check.
 *
 * Two independent things are asserted:
 *   1. No live HTTP client library or call — `fetch(`, `axios`, `XMLHttp
 *      Request`, `node-fetch`, `http.request`, `https.request` — appears
 *      under `src/modules/paid/`. This is the WBS 7D.2 acceptance criterion
 *      "no live HTTP client anywhere (no fetch/axios call to any Meta/
 *      graph.facebook.com domain)".
 *   2. No reference to the Meta Ads MCP (`mcp.facebook.com`, or the literal
 *      domain `graph.facebook.com` a live Marketing API client would need)
 *      appears ANYWHERE in `backend/src` — restating, for the paid module
 *      specifically, the same MCP-non-coupling guarantee WBS 7A.6 enforces
 *      system-wide (phase7-project-plan.md Decision 2).
 */

import { listTsFiles, readSource, stripComments, wordBoundaryPattern } from '../source-scan.util';

const PAID_SIDE_DIRS = ['src/modules/paid'];

/**
 * "Anywhere in application source" — deliberately `src/modules`, `src/
 * common`, and `src/config`, NOT a literal `listTsFiles('src')`. The latter
 * would also walk `src/testing/`, which is where THIS spec file itself
 * lives and necessarily contains the literal domain string it is scanning
 * for (the string in its own token array below) — a self-referential match
 * that would fail the moment this test was written, for a reason that has
 * nothing to do with a real MCP coupling. `src/testing/` is deliberately
 * outside every scanned zone for the identical reason
 * `commerce-boundary.spec.ts` excludes it (source-scan.util.ts's own
 * docblock) — application runtime code lives in these three directories and
 * nowhere else.
 */
const APPLICATION_SOURCE_DIRS = ['src/modules', 'src/common', 'src/config'];

/**
 * Deliberately includes the trailing `(` on `fetch(`/`http.request(`/
 * `https.request(` so the scan matches a CALL, not merely the identifier
 * appearing in a comment or doc-string reference to "no fetch() call" — the
 * comment-stripping step already removes prose, but the parenthesis keeps
 * the intent explicit for anyone reading this list later.
 */
const HTTP_CLIENT_TOKENS = [
  'fetch(',
  'axios',
  'XMLHttpRequest',
  'node-fetch',
  'http.request(',
  'https.request(',
];

/** The literal hosts a live Meta integration would ever need to name. */
const META_DOMAIN_TOKENS = ['graph.facebook.com', 'mcp.facebook.com'];

function scan(dirs: string[], tokens: string[]): string[] {
  const offenders: string[] = [];

  for (const dir of dirs) {
    for (const file of listTsFiles(dir)) {
      const code = stripComments(readSource(file));
      for (const token of tokens) {
        if (wordBoundaryPattern(token).test(code)) {
          offenders.push(`${file} → ${token}`);
        }
      }
    }
  }

  return offenders;
}

describe('WBS 7D.2 — no live HTTP client under modules/paid', () => {
  it('scans a non-empty set of paid-side files (guards against a silently empty scan)', () => {
    const paidFiles = PAID_SIDE_DIRS.flatMap((dir) => listTsFiles(dir));
    expect(paidFiles.length).toBeGreaterThan(0);
  });

  it('no paid source file contains an HTTP client call (fetch/axios/XMLHttpRequest/node-fetch/http(s).request)', () => {
    expect(scan(PAID_SIDE_DIRS, HTTP_CLIENT_TOKENS)).toEqual([]);
  });

  it('no paid source file names a Meta Graph API or Meta Ads MCP domain', () => {
    expect(scan(PAID_SIDE_DIRS, META_DOMAIN_TOKENS)).toEqual([]);
  });

  it('no reference to the Meta Ads MCP domain exists anywhere in application source (Decision 2, system-wide)', () => {
    expect(scan(APPLICATION_SOURCE_DIRS, ['mcp.facebook.com'])).toEqual([]);
  });
});
