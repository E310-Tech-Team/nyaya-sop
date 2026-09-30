/**
 * Where a directory import gets its rows. Every source (the RCCG spreadsheet now, the RCCG
 * API later) turns its data into the same rows, so cleaning, matching, dry runs, applying and
 * history (./plan.ts, ./store.ts) never depend on where the data came from.
 */
import { createHash } from 'node:crypto';
import { readXlsx, type XlsxSheet } from './xlsx';

/** One parish as the source lists it: raw text, cleaned later by the planner. */
export type SourceRow = {
  /** Where the row is in the source (the spreadsheet row number), for reports. */
  line: number;
  continent: string;
  region: string;
  province: string;
  parish: string;
};

export type DirectorySource = {
  kind: 'spreadsheet' | 'api';
  /** The file name, or a description of the sync run. */
  label: string;
  checksum: string | null;
  read(): Promise<{ rows: SourceRow[]; notes: string[] }>;
};

export class SourceError extends Error {}

const COLUMNS = ['continent', 'region', 'province', 'parish'] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, RegExp> = {
  continent: /^CONTINENT$/,
  region: /^REGION$/,
  province: /^PROVINCE$/,
  parish: /^PARISH( NAME)?$/,
};

// Title rows can sit above the header; the header must be within the first rows.
const HEADER_SEARCH_ROWS = 20;

const headerText = (cell: string) => cell.trim().toUpperCase().replace(/\s+/g, ' ');

function findColumns(cells: string[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  cells.forEach((cell, index) => {
    const text = headerText(cell);
    for (const column of COLUMNS) if (found[column] === undefined && HEADERS[column].test(text)) found[column] = index;
  });
  return found;
}

function readSheet(sheet: XlsxSheet): { rows: SourceRow[]; missing: Column[] } {
  let columns: Partial<Record<Column, number>> | null = null;
  let best: Partial<Record<Column, number>> = {};
  const rows: SourceRow[] = [];
  let seen = 0;
  for (const { line, cells } of sheet.rows()) {
    if (!columns) {
      const found = findColumns(cells);
      if (Object.keys(found).length > Object.keys(best).length) best = found;
      if (COLUMNS.every((column) => found[column] !== undefined)) columns = found;
      else if (++seen >= HEADER_SEARCH_ROWS) break;
      continue;
    }
    // Only the four directory columns are read; every other column (such as attendance) is ignored.
    const value = (column: Column) => cells[columns![column]!] ?? '';
    const row = { line, continent: value('continent'), region: value('region'), province: value('province'), parish: value('parish') };
    if (COLUMNS.some((column) => row[column].trim())) rows.push(row);
  }
  return { rows, missing: columns ? [] : COLUMNS.filter((column) => best[column] === undefined) };
}

/**
 * An .xlsx file with CONTINENT, REGION, PROVINCE and PARISH columns (in any order, after any
 * title rows), read from the first visible sheet that has them.
 */
export function spreadsheetSource(label: string, file: Buffer): DirectorySource {
  return {
    kind: 'spreadsheet',
    label,
    checksum: createHash('sha256').update(file).digest('hex'),
    async read() {
      const sheets = readXlsx(file).filter((sheet) => !sheet.hidden);
      let missing: Column[] = [...COLUMNS];
      for (const sheet of sheets) {
        const result = readSheet(sheet);
        if (!result.missing.length) return { rows: result.rows, notes: [`Read sheet "${sheet.name}".`] };
        if (result.missing.length < missing.length) missing = result.missing;
      }
      throw new SourceError(
        `No sheet has the columns CONTINENT, REGION, PROVINCE and PARISH. Missing: ${missing.map((column) => column.toUpperCase()).join(', ')}.`,
      );
    },
  };
}

/** Rows already in memory: tests, and the shape an API source will produce. */
export function rowsSource(label: string, rows: SourceRow[], kind: DirectorySource['kind'] = 'api'): DirectorySource {
  return { kind, label, checksum: null, read: async () => ({ rows, notes: [] }) };
}
