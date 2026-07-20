/**
 * Source-text scanning helpers for the Phase 6 static separation tests.
 *
 * WHY THIS LIVES IN `src/testing/` AND NOT IN A `.spec.ts`
 * -------------------------------------------------------
 * The boundary scan (src/testing/separation/commerce-boundary.spec.ts) walks
 * every `.ts` file under the payout/ranking directories with NO exclusion —
 * not even for `*.spec.ts`. The design originally exempted spec files because
 * the payout regression fixture legitimately seeds commerce rows and must be
 * allowed to name them. The System Analyst's ruling (docs/phase6-system-
 * analysis.md §2, G3b / condition B3) was: that exemption solves a problem the
 * correct file layout does not have. Put the fixtures OUTSIDE the scanned
 * directories — here — and the scan can be total.
 *
 * So `src/testing/` is deliberately a sibling of `src/modules/`, not a child
 * of any scanned module. Nothing under `src/testing/` is imported by runtime
 * code; it exists only for tests.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** Repo-relative root every scan path is resolved against (`backend/`). */
export const BACKEND_ROOT = join(__dirname, '..', '..');

/**
 * Every `.ts` file under `dir`, recursively, as backend-relative paths.
 *
 * Deliberately has NO exclusion parameter. A scan you can opt out of is a scan
 * whose result means nothing — if a file must be allowed to name a commerce
 * symbol, it belongs outside the scanned directory, which is exactly what
 * `src/testing/` is for (condition B3).
 */
export function listTsFiles(dir: string): string[] {
  const absolute = join(BACKEND_ROOT, dir);
  const found: string[] = [];

  for (const entry of readdirSync(absolute)) {
    const relative = join(dir, entry);
    if (statSync(join(BACKEND_ROOT, relative)).isDirectory()) {
      found.push(...listTsFiles(relative));
    } else if (entry.endsWith('.ts')) {
      found.push(relative);
    }
  }

  return found.sort();
}

/** Reads a backend-relative path as UTF-8. */
export function readSource(relativePath: string): string {
  return readFileSync(join(BACKEND_ROOT, relativePath), 'utf8');
}

/**
 * Removes `//` and block comments, preserving string and template literals.
 *
 * The System Analyst's G3c finding: scanning raw text for a token like
 * `metrics` matches ordinary prose — including a comment explaining *why*
 * commerce does not touch metrics. The separation tests would then fail for
 * documentation and the team would learn to edit the token list around them,
 * which is worse than no test.
 *
 * String literals are deliberately KEPT. They are the sneaky case the scan
 * exists for: a physical table name inside a `$queryRaw` tagged template is
 * invisible to ESLint and to an AST import walk, and it is exactly how a
 * boundary breach would look if someone tried to route around Layer 1.
 *
 * Comments are replaced by a single space rather than deleted, so a token can
 * never be formed by splicing the text on either side of a comment together.
 */
export function stripComments(source: string): string {
  let output = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      output += ' ';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      output += ' ';
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      output += char;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          output += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        output += source[index];
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

/**
 * Builds a word-boundary regex for a literal token (G3c).
 *
 * `\b` does not fire around `.`, so `prisma.metric` is anchored with an
 * explicit lookahead instead of relying on a trailing `\b` after a dot-joined
 * identifier. Escapes regex metacharacters in the token so a dot in
 * `prisma.metric` matches a literal dot, not "any character".
 */
export function wordBoundaryPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
}
