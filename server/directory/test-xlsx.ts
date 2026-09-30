/**
 * Builds small .xlsx files in memory for tests, so no spreadsheet is ever committed (the RCCG
 * files stay out of the repository: docs/DEPLOYMENT.md, "Parish directory").
 */
import { crc32, deflateRawSync } from 'node:zlib';

/** A zip archive of the given files, deflated or stored. */
export function buildZip(files: Record<string, string>, compress = true): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const body = compress ? deflateRawSync(data) : data;
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);

    parts.push(local, fileName, body);
    directory.push(central, fileName);
    offset += 30 + fileName.length + body.length;
  }
  const size = directory.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

export type FixtureCell = string | number | null;
export type FixtureSheet = {
  name: string;
  rows: FixtureCell[][];
  hidden?: boolean;
  /** Write strings inline instead of through the shared-strings table. */
  inline?: boolean;
};

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A workbook with these sheets. Null cells are left out, as Excel does. */
export function buildXlsx(sheets: FixtureSheet[], compress = true): Buffer {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const files: Record<string, string> = {};

  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows
      .map((cells, rowIndex) => {
        const line = rowIndex + 1;
        const xml = cells
          .map((value, column) => {
            if (value === null) return '';
            const ref = `${columnName(column)}${line}`;
            if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
            if (sheet.inline) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
            let index = sharedIndex.get(value);
            if (index === undefined) sharedIndex.set(value, (index = shared.push(value) - 1));
            return `<c r="${ref}" t="s"><v>${index}</v></c>`;
          })
          .join('');
        return xml ? `<row r="${line}">${xml}</row>` : '';
      })
      .join('');
    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });

  files['xl/workbook.xml'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheets
      .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${index + 1}"/>`)
      .join('') +
    `</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
      .join('') +
    `</Relationships>`;
  files['xl/sharedStrings.xml'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('') +
    `</sst>`;
  return buildZip(files, compress);
}
