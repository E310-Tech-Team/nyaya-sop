import {
  AGE_RANGES,
  CURRENT_STATUSES,
  EDUCATION_LEVELS,
  PURPOSE_SCALE,
  STORED_GENDERS,
  formatPhone,
  labelFor,
  referenceFromId,
} from '../src/shared/application';
import { PARISH_ANSWER_LABELS } from '../src/shared/directory';
import type { ApplicationExportRow } from './repository';

type Cell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d[\d ]*$/;

/**
 * RFC 4180 quoting, plus a leading apostrophe on values that spreadsheet apps would
 * otherwise run as formulas (CSV injection: =, +, -, @, tab, carriage return).
 * Plain signed numbers such as "+447700900123" are harmless and left alone.
 * Every field is quoted: spreadsheets set to a semicolon separator (much of Europe) would
 * otherwise split "Ade;=1+2" into a new cell that starts with "=".
 */
export function csvCell(value: Cell): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF, an optional byte-order mark) as
 * rows of cells. Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  const endRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    cell = '';
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      endRow();
    } else cell += char;
  }
  if (cell || row.length) endRow();
  return rows;
}

// Reviewers are in Nigeria; show submission times in West Africa Time.
const lagosTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const formatTime = (date: Date) => lagosTime.format(date).replace(',', '');

const HEADER = [
  'Reference',
  'Submitted (WAT)',
  'Cohort',
  'Review status',
  'Published status',
  'Full name',
  'Email',
  'Phone',
  'Gender',
  'Age range',
  'State of residence',
  'City/Town',
  'RCCG parish',
  'Parish answer',
  'Parish (directory)',
  'Province',
  'Region',
  'Continent',
  'Highest education',
  'Current status',
  'Purpose clarity (1-5)',
  'Consent version',
  'UTM source',
  'UTM medium',
  'UTM campaign',
  'Referrer',
];

export function applicationsToCsv(rows: ApplicationExportRow[]): string {
  return toCsv(
    HEADER,
    rows.map((row) => [
      referenceFromId(row.id),
      formatTime(row.created_at),
      row.cohort_slug,
      row.status,
      row.published_status ?? '',
      row.full_name,
      row.email,
      formatPhone(row.phone_e164),
      labelFor(STORED_GENDERS, row.gender), // an earlier application may say "Prefer not to say (earlier form)"
      labelFor(AGE_RANGES, row.age_range),
      row.state_of_residence,
      row.city,
      row.parish_name,
      row.parish_status ? (PARISH_ANSWER_LABELS[row.parish_status as keyof typeof PARISH_ANSWER_LABELS] ?? row.parish_status) : '',
      row.directory_parish,
      row.province,
      row.region,
      row.continent,
      labelFor(EDUCATION_LEVELS, row.education_level),
      labelFor(CURRENT_STATUSES, row.current_status),
      `${row.purpose_clarity} - ${labelFor(PURPOSE_SCALE, row.purpose_clarity)}`,
      row.consent_version,
      row.submission_meta?.utmSource,
      row.submission_meta?.utmMedium,
      row.submission_meta?.utmCampaign,
      row.submission_meta?.referrer,
    ]),
  );
}
