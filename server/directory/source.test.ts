import { describe, expect, it } from 'vitest';
import { SourceError, spreadsheetSource } from './source';
import { buildXlsx } from './test-xlsx';

describe('spreadsheetSource', () => {
  it('finds the header under title rows and reads only the four directory columns', async () => {
    const file = buildXlsx([
      {
        name: 'AVG. ATTENDANCE',
        rows: [
          ['RCCG PARISHES'],
          [],
          [' Continent ', 'REGION', 'PROVINCE', 'Parish  Name', 'AVG(SEP-25 & APR-26)'],
          ['CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE', 987654],
          [null, null, null, null, 123456],
          ['CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'AMAZING GRACE', 55501],
        ],
      },
    ]);
    const { rows, notes } = await spreadsheetSource('RCCG PARISHES.xlsx', file).read();
    expect(notes).toEqual(['Read sheet "AVG. ATTENDANCE".']);
    expect(rows).toEqual([
      { line: 4, continent: 'CONTINENT 3', region: 'REGION 54', province: 'LAGOS PROVINCE 3', parish: 'JESUS HOUSE' },
      { line: 6, continent: 'CONTINENT 3', region: 'REGION 54', province: 'LAGOS PROVINCE 3', parish: 'AMAZING GRACE' },
    ]);
    // The attendance figures never leave the file.
    expect(JSON.stringify(rows)).not.toMatch(/987654|123456|55501/);
  });

  it('accepts the columns in any order and skips hidden sheets', async () => {
    const file = buildXlsx([
      { name: 'Old', hidden: true, rows: [['CONTINENT', 'REGION', 'PROVINCE', 'PARISH'], ['X', 'X', 'X', 'HIDDEN']] },
      { name: 'Notes', rows: [['Read me']] },
      { name: 'List', rows: [['PARISH', 'PROVINCE', 'REGION', 'CONTINENT'], ['GRACE', 'OGUN PROVINCE 1', 'REGION 2', 'CONTINENT 3']] },
    ]);
    const { rows, notes } = await spreadsheetSource('list.xlsx', file).read();
    expect(notes).toEqual(['Read sheet "List".']);
    expect(rows).toEqual([{ line: 2, continent: 'CONTINENT 3', region: 'REGION 2', province: 'OGUN PROVINCE 1', parish: 'GRACE' }]);
  });

  it('names the missing columns', async () => {
    const file = buildXlsx([{ name: 'List', rows: [['CONTINENT', 'REGION', 'PARISH'], ['a', 'b', 'c']] }]);
    await expect(spreadsheetSource('list.xlsx', file).read()).rejects.toThrow(new SourceError(
      'No sheet has the columns CONTINENT, REGION, PROVINCE and PARISH. Missing: PROVINCE.',
    ));
  });

  it('fingerprints the file', () => {
    const file = buildXlsx([{ name: 'List', rows: [['x']] }]);
    expect(spreadsheetSource('a.xlsx', file).checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
