import { describe, expect, it } from 'vitest';
import { buildXlsx, buildZip } from './test-xlsx';
import { readXlsx, XlsxError } from './xlsx';

const rowsOf = (file: Buffer, sheet = 0) => [...readXlsx(file)[sheet]!.rows()];

describe('readXlsx', () => {
  it('reads shared and inline strings, numbers and gaps, compressed or stored', () => {
    for (const compress of [true, false]) {
      for (const inline of [false, true]) {
        const file = buildXlsx(
          [{ name: 'List', inline, rows: [['CONTINENT', 'REGION'], ['CONTINENT 3', null, 'LAGOS & CO <1>', 42]] }],
          compress,
        );
        expect(rowsOf(file)).toEqual([
          { line: 1, cells: ['CONTINENT', 'REGION'] },
          { line: 2, cells: ['CONTINENT 3', '', 'LAGOS & CO <1>', '42'] },
        ]);
      }
    }
  });

  it('keeps spreadsheet row numbers when rows are skipped', () => {
    const file = buildXlsx([{ name: 'List', rows: [['Title'], [], [], ['A', 'B']] }]);
    expect(rowsOf(file).map((row) => row.line)).toEqual([1, 4]);
  });

  it('lists sheets in tab order and marks hidden ones', () => {
    const file = buildXlsx([
      { name: 'Notes', hidden: true, rows: [['x']] },
      { name: 'Parishes', rows: [['y']] },
    ]);
    expect(readXlsx(file).map(({ name, hidden }) => ({ name, hidden }))).toEqual([
      { name: 'Notes', hidden: true },
      { name: 'Parishes', hidden: false },
    ]);
    expect(rowsOf(file, 1)[0]!.cells).toEqual(['y']);
  });

  it('joins rich-text runs, skips phonetic guides and decodes escapes', () => {
    const file = buildZip({
      'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/s.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><r><rPr><b/></rPr><t>GOD</t></r><r><t xml:space="preserve">&apos;S GIFT</t></r><rPh sb="0" eb="1"><t>x</t></rPh></si><si><t>LINE_x000A_BREAK</t></si></sst>',
      'xl/worksheets/s.xml':
        '<worksheet><sheetData><row r="3"><c r="B3" t="s"><v>0</v></c><c r="C3" t="s"><v>1</v></c><c r="D3" t="b"><v>1</v></c><c r="E3" s="2"/></row></sheetData></worksheet>',
    });
    expect(rowsOf(file)).toEqual([{ line: 3, cells: ['', "GOD'S GIFT", 'LINE\nBREAK', 'TRUE', ''] }]);
  });

  it('refuses references beyond Excel’s limits, and damaged XML, without running out of memory or time (security audit)', () => {
    const sheet = (xml: string) =>
      buildZip({
        'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/s.xml"/></Relationships>',
        'xl/worksheets/s.xml': `<worksheet><sheetData>${xml}</sheetData></worksheet>`,
      });
    expect(rowsOf(sheet('<row r="1"><c r="XFD1"><v>1</v></c></row>'))[0]!.cells).toHaveLength(16_384);
    expect(() => rowsOf(sheet('<row r="1"><c r="ZZZZZZ1"><v>1</v></c></row>'))).toThrow(/beyond XFD/);
    for (const r of ['-5', '2000000', '2.5']) expect(() => rowsOf(sheet(`<row r="${r}"><c><v>1</v></c></row>`))).toThrow(/outside 1 to/);
    const started = performance.now();
    expect(() => rowsOf(sheet('<row r="1">'.repeat(20_000)))).toThrow(/damaged/);
    expect(() => rowsOf(sheet(`<row r="1">${'<c r="A1"><v>1'.repeat(20_000)}</row>`))).toThrow(/damaged/);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('refuses files that are not workbooks', () => {
    expect(() => readXlsx(Buffer.from('CONTINENT,REGION\n'))).toThrow(XlsxError);
    expect(() => readXlsx(buildZip({ 'word/document.xml': '<w/>' }))).toThrow(/not an Excel workbook/);
  });
});
