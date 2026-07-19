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
      expect(escapeCsvField('-5')).toBe("'-5");
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

    it('does not mangle a plain negative NUMBER (numbers are not strings from a user)', () => {
      // Numbers still get the guard when stringified — deliberate: correctness
      // of the export beats prettiness, and a leading-'-' cell is exactly the
      // injection shape. Consumers read the numeric columns, not the glyph.
      expect(escapeCsvField(-5)).toBe("'-5");
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
