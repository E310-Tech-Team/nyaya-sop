import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { planImport } from './plan';
import { issuesCsv, planSummary } from './report';

const rows = [
  { line: 2, continent: 'CONTINENT 3', region: 'REGION 54', province: 'LAGOS PROVINCE 3', parish: 'DIVINE FAVOUR' },
  { line: 3, continent: 'CONTINENT 3', region: 'REGION 54', province: 'LAGOS PROVINCE 3', parish: 'RCCG, DIVINE FAVOUR PARISH' },
  { line: 4, continent: 'CONTINENT 3', region: 'REGION 54', province: 'REGION 54', parish: '=HYPERLINK("x")' },
];
const plan = planImport(rows, { units: [], parishes: [], aliases: [], lineage: [] });

describe('planSummary', () => {
  it('gives the figures and examples of each issue', () => {
    const text = planSummary(plan).join('\n');
    expect(text).toContain('3 rows, 2 parish entries');
    expect(text).toContain('Parishes: create 2, update 0, move 0, reactivate 0, deactivate 0, unchanged 0');
    expect(text).toContain('duplicate_name (warning): 1');
    expect(text).toContain('Row 2: 2 rows list Divine Favour under Lagos Province 3');
  });
});

describe('issuesCsv', () => {
  it('writes one issue per line, safe to open in a spreadsheet', () => {
    const [header, ...lines] = parseCsv(issuesCsv(plan.issues));
    expect(header).toEqual(['Severity', 'Issue', 'Row', 'Message', 'Unit', 'Parish', 'Rows', 'Spellings']);
    expect(lines).toContainEqual([
      'warning',
      'duplicate_name',
      '2',
      '2 rows list Divine Favour under Lagos Province 3; they are one entry until RCCG confirms otherwise.',
      'Lagos Province 3',
      'Divine Favour',
      '2; 3',
      'DIVINE FAVOUR; RCCG, DIVINE FAVOUR PARISH',
    ]);
    // A name that looks like a formula is written as text.
    expect(lines.find((line) => line[1] === 'no_province')![5]).toBe(`'=Hyperlink("X")`);
  });
});

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, CRLF and a byte-order mark, and drops blank lines', () => {
    expect(parseCsv('﻿level,unit\r\nprovince,"LAGOS PROVINCE 135"\r\n\r\nregion,"A ""quoted"", name"\nlast,row')).toEqual([
      ['level', 'unit'],
      ['province', 'LAGOS PROVINCE 135'],
      ['region', 'A "quoted", name'],
      ['last', 'row'],
    ]);
  });

  it('keeps empty cells', () => {
    expect(parseCsv('a,,c\n,b,\n')).toEqual([
      ['a', '', 'c'],
      ['', 'b', ''],
    ]);
  });
});
