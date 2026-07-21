/**
 * Phase 6.0.6 — the frozen commerce policy values.
 *
 * These are policy decisions, not implementation details, and they ship in the
 * 6.0 gate before any endpoint exists so that they are reviewed alongside the
 * schema rather than invented later under feature pressure. This spec is what
 * makes them decisions rather than suggestions.
 */

import {
  COMMERCE_ERASABLE_FREE_TEXT_COLUMNS,
  COMMERCE_PLACEMENT_NOTE_MAX_LENGTH,
  COMMERCE_STATEMENT_REF_MAX_LENGTH,
  COMMERCE_STATEMENT_REF_PATTERN,
  COMMERCE_SUPPORTED_CURRENCIES,
} from './commerce.constants';

describe('A1 — statement_ref format constraint', () => {
  it.each(['SHP-2026-W29', 'statement.2026_07_20', 'A', 'TT/2026/07/000123', '0812345678'])(
    'accepts statement-shaped value %p',
    (value) => {
      expect(COMMERCE_STATEMENT_REF_PATTERN.test(value)).toBe(true);
    },
  );

  describe("rejects what the design's regex let through", () => {
    // The whole point of A1. The design's class included a space, so every
    // one of these Latin-script personal-data strings passed a control whose
    // stated purpose was to stop exactly them.
    it.each(['John Smith', 'Somchai P', 'Ratchada Rd 42', 'Order 55123 Somchai'])(
      'rejects %p (contains a space)',
      (value) => {
        expect(COMMERCE_STATEMENT_REF_PATTERN.test(value)).toBe(false);
      },
    );
  });

  it.each([
    ['', 'empty'],
    ['.leading-dot', 'first character is not alphanumeric'],
    ['-SHP-2026', 'first character is not alphanumeric'],
    ['somchai@example.com', 'contains @'],
    ['+66812345678', 'contains +'],
    ['สมชาย', 'Thai script'],
    ['SHP,2026', 'contains a comma'],
    ['SHP\n2026', 'contains a newline'],
  ])('rejects %p (%s)', (value) => {
    expect(COMMERCE_STATEMENT_REF_PATTERN.test(value)).toBe(false);
  });

  it('is length-bounded in the pattern itself, at the DB CHECK boundary', () => {
    const atLimit = 'A'.repeat(COMMERCE_STATEMENT_REF_MAX_LENGTH);
    const overLimit = 'A'.repeat(COMMERCE_STATEMENT_REF_MAX_LENGTH + 1);

    expect(atLimit).toHaveLength(64);
    expect(COMMERCE_STATEMENT_REF_PATTERN.test(atLimit)).toBe(true);
    expect(COMMERCE_STATEMENT_REF_PATTERN.test(overLimit)).toBe(false);
  });

  it('is anchored at both ends', () => {
    // An unanchored pattern would accept "Somchai SHP-2026" by matching the
    // tail. Asserted explicitly because losing an anchor is a silent,
    // one-character regression.
    expect(COMMERCE_STATEMENT_REF_PATTERN.source.startsWith('^')).toBe(true);
    expect(COMMERCE_STATEMENT_REF_PATTERN.source.endsWith('$')).toBe(true);
    expect(COMMERCE_STATEMENT_REF_PATTERN.global).toBe(false);
  });
});

describe('A4 — note length cap', () => {
  it("is 200 characters, not the design's 500", () => {
    // 200 still holds "reshot vertical, approved by admin 07-14"; 500 was an
    // invitation. Enforced in the migration by
    // commerce_placements_note_len_chk — this constant must not drift from it.
    expect(COMMERCE_PLACEMENT_NOTE_MAX_LENGTH).toBe(200);
  });
});

describe('A5 — erasure surface', () => {
  it('names exactly the four PII-capable columns', () => {
    expect(COMMERCE_ERASABLE_FREE_TEXT_COLUMNS).toEqual([
      { table: 'commerce_conversions', column: 'statement_ref' },
      { table: 'commerce_placements', column: 'note' },
      { table: 'affiliate_links', column: 'tracking_code' },
      { table: 'affiliate_links', column: 'sub_id' },
    ]);
  });
});

describe('SA-9 — currency guard', () => {
  it('accepts THB only in v1', () => {
    expect(COMMERCE_SUPPORTED_CURRENCIES).toEqual(['THB']);
  });

  it('every supported currency matches the DB CHECK pattern', () => {
    // The column CHECK is `currency ~ '^[A-Z]{3}$'`. A lowercase or padded
    // entry in this list would be insertable-looking in code and rejected by
    // Postgres — and would fragment every GROUP BY currency if it ever landed.
    for (const currency of COMMERCE_SUPPORTED_CURRENCIES) {
      expect(currency).toMatch(/^[A-Z]{3}$/);
    }
  });
});
