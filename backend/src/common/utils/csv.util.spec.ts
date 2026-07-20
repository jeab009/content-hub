import { escapeCsvField, toCsv } from './csv.util';

describe('csv.util', () => {
  describe('escapeCsvField — CSV injection (the security-relevant half)', () => {
    it.each(['=', '+', '-', '@'])(
      'neutralizes a field starting with "%s" so it can never execute',
      (prefix) => {
        const escaped = escapeCsvField(`${prefix}cmd|/C calc!A1`);

        // The guard quote lands before the formula character, so the cell is
        // text. (No comma/quote/newline here, so there is no RFC-4180 wrapping
        // to look past.)
        expect(escaped).toBe(`'${prefix}cmd|/C calc!A1`);
      },
    );

    it('prefixes a formula field so a spreadsheet renders it as text', () => {
      // No comma/quote/newline, so no wrapping — just the quote guard.
      expect(escapeCsvField('=1+1')).toBe("'=1+1");
      expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
    });

    // Phase 6 (System Analyst C8): a leading `-` followed by anything OTHER
    // than a plain number is still a potential formula and is still defanged.
    it('still defangs a leading-minus payload that is NOT a plain number', () => {
      expect(escapeCsvField('-1+1')).toBe("'-1+1"); // arithmetic, not a number
      expect(escapeCsvField('-cmd|/C calc')).toBe("'-cmd|/C calc");
      expect(escapeCsvField("=cmd|' /C calc'!A1")).toBe("'=cmd|' /C calc'!A1");
    });

    it('neutralizes leading tab and carriage return too', () => {
      // Tab needs no RFC-4180 wrapping, so it is the bare guard...
      expect(escapeCsvField('\t=cmd')).toBe("'\t=cmd");
      // ...while CR does, so the guard sits inside the quotes.
      expect(escapeCsvField('\r=cmd')).toBe('"\'\r=cmd"');
    });

    it('leaves a formula character in a NON-leading position alone', () => {
      expect(escapeCsvField('a=b')).toBe('a=b');
      expect(escapeCsvField('Q1-2026')).toBe('Q1-2026');
    });

    // Phase 6 (System Analyst C8/C7): a plain number — including a NEGATIVE one
    // — is never a formula, so it must NOT be quote-prefixed. Commerce
    // reversals are negative by design, and a `'-240.00` text cell is a money
    // error the moment an admin sums the column. This is the behaviour change:
    // before Phase 6, `-5` exported as the un-summable text `'-5`.
    it('leaves a plain negative number summable (does NOT formula-prefix it)', () => {
      expect(escapeCsvField(-5)).toBe('-5');
      expect(escapeCsvField(-240)).toBe('-240');
      expect(escapeCsvField(-250.0)).toBe('-250'); // JS number: trailing zeros gone
      expect(escapeCsvField('-250.00')).toBe('-250.00'); // string form preserved
      expect(escapeCsvField(42)).toBe('42');
      expect(escapeCsvField(3.14)).toBe('3.14');
    });
  });

  describe('escapeCsvField — RFC 4180 quoting', () => {
    it('quotes fields containing a comma', () => {
      expect(escapeCsvField('Bangkok, Thailand')).toBe('"Bangkok, Thailand"');
    });

    it('doubles inner quotes', () => {
      expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
    });

    it('quotes fields containing newlines', () => {
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('renders null/undefined as empty', () => {
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
    });

    it('renders booleans', () => {
      expect(escapeCsvField(true)).toBe('true');
      expect(escapeCsvField(false)).toBe('false');
    });
  });

  describe('toCsv', () => {
    it('renders a header row and data rows with CRLF endings', () => {
      const csv = toCsv(
        ['a', 'b'],
        [
          [1, 'x'],
          [2, 'y'],
        ],
      );

      expect(csv).toBe('a,b\r\n1,x\r\n2,y\r\n');
    });

    it('renders a header-only document when there are no rows', () => {
      expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
    });

    it('escapes every cell it writes', () => {
      const csv = toCsv(['name'], [['=EVIL()'], ['plain']]);

      expect(csv).toBe("name\r\n'=EVIL()\r\nplain\r\n");
    });
  });
});
