/**
 * Phase 7.0 — the frozen paid/ads policy values (System Analyst conditions
 * P-A1, P-A4, SA-P4, SA-P6). These are policy decisions, not implementation
 * details, and they shipped in the 7.0 gate before any endpoint existed so
 * they were reviewed alongside the schema rather than invented later under
 * feature pressure. Mirrors `commerce.constants.spec.ts` exactly.
 */

import {
  PAID_ERASABLE_FREE_TEXT_COLUMNS,
  PAID_OBJECTIVE_MAX_LENGTH,
  PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS,
  PAID_SOURCE_REF_MAX_LENGTH,
  PAID_SOURCE_REF_PATTERN,
  PAID_SUPPORTED_CURRENCIES,
  PAID_TABLE_COLUMNS,
} from './paid.constants';

describe('P-A1 — sourceRef format constraint', () => {
  it.each(['META-2026-W29', 'adsmgr.2026_07_20', 'A', 'FB/2026/07/000123', '0812345678'])(
    'accepts source-ref-shaped value %p',
    (value) => {
      expect(PAID_SOURCE_REF_PATTERN.test(value)).toBe(true);
    },
  );

  describe('rejects the design draft regex defect (the space)', () => {
    // The whole point of P-A1. The design draft's quoted regex included a
    // space, so every one of these Latin-script personal-data strings would
    // have passed a control whose stated purpose was to stop exactly them.
    it.each(['John Smith', 'Somchai P', 'Ratchada Rd 42', 'Order 55123 Somchai'])(
      'rejects %p (contains a space)',
      (value) => {
        expect(PAID_SOURCE_REF_PATTERN.test(value)).toBe(false);
      },
    );
  });

  it.each([
    ['', 'empty'],
    ['.leading-dot', 'first character is not alphanumeric'],
    ['-META-2026', 'first character is not alphanumeric'],
    ['somchai@example.com', 'contains @'],
    ['+66812345678', 'contains +'],
    ['สมชาย', 'Thai script'],
    ['META,2026', 'contains a comma'],
    ['META\n2026', 'contains a newline'],
  ])('rejects %p (%s)', (value) => {
    expect(PAID_SOURCE_REF_PATTERN.test(value)).toBe(false);
  });

  it('is length-bounded in the pattern itself, at the DB CHECK boundary', () => {
    const atLimit = 'A'.repeat(PAID_SOURCE_REF_MAX_LENGTH);
    const overLimit = 'A'.repeat(PAID_SOURCE_REF_MAX_LENGTH + 1);

    expect(atLimit).toHaveLength(64);
    expect(PAID_SOURCE_REF_PATTERN.test(atLimit)).toBe(true);
    expect(PAID_SOURCE_REF_PATTERN.test(overLimit)).toBe(false);
  });

  it('is anchored at both ends', () => {
    // An unanchored pattern would accept "Somchai META-2026" by matching the
    // tail. Asserted explicitly because losing an anchor is a silent,
    // one-character regression.
    expect(PAID_SOURCE_REF_PATTERN.source.startsWith('^')).toBe(true);
    expect(PAID_SOURCE_REF_PATTERN.source.endsWith('$')).toBe(true);
    expect(PAID_SOURCE_REF_PATTERN.global).toBe(false);
  });

  it('is identical in shape to the shipped Commerce fix (verbatim copy, not the design draft)', () => {
    // Deliberately a hardcoded literal, NOT an import of
    // `COMMERCE_STATEMENT_REF_PATTERN` — `modules/paid` must never import
    // `modules/commerce` (the three-way ESLint zone and the static boundary
    // scan both ban it), so this duplication is the price of proving the
    // shape matches without crossing the boundary. Both copies must be
    // edited together if the pattern is ever revised.
    expect(PAID_SOURCE_REF_PATTERN.source).toBe(/^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$/.source);
  });
});

describe('objective length cap', () => {
  it('is 100 characters', () => {
    expect(PAID_OBJECTIVE_MAX_LENGTH).toBe(100);
  });
});

describe('P-A4 — erasure surface', () => {
  it('names exactly the two PII-capable columns', () => {
    expect(PAID_ERASABLE_FREE_TEXT_COLUMNS).toEqual([
      { table: 'ad_campaigns', column: 'objective' },
      { table: 'ad_performance_entries', column: 'source_ref' },
    ]);
  });
});

describe('SA-P6 — currency guard', () => {
  it('accepts THB only in v1', () => {
    expect(PAID_SUPPORTED_CURRENCIES).toEqual(['THB']);
  });

  it('every supported currency matches the DB CHECK pattern', () => {
    // The column CHECK is `currency ~ '^[A-Z]{3}$'`. A lowercase or padded
    // entry in this list would be insertable-looking in code and rejected by
    // Postgres — and would fragment every GROUP BY currency if it ever landed.
    for (const currency of PAID_SUPPORTED_CURRENCIES) {
      expect(currency).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe('§4.2 finding — performance-entry idempotency window', () => {
  it('matches the shipped Commerce window (60s)', () => {
    expect(PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS).toBe(60 * 1000);
  });
});

describe('NFR-7.5 — the frozen column inventory', () => {
  it('covers exactly the two paid tables', () => {
    expect(Object.keys(PAID_TABLE_COLUMNS).sort()).toEqual([
      'ad_campaigns',
      'ad_performance_entries',
    ]);
  });

  it('has no audience/segment/pixel/recipient-shaped column name', () => {
    const banned = /audience|segment|pixel|lookalike|recipient|click_id|impression_id/i;
    const offenders = Object.entries(PAID_TABLE_COLUMNS).flatMap(([table, columns]) =>
      columns.filter((column) => banned.test(column)).map((column) => `${table}.${column}`),
    );
    expect(offenders).toEqual([]);
  });
});
