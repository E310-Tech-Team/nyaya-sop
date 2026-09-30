/**
 * A small reader for .xlsx workbooks, the format RCCG sends its parish list in. It unzips with
 * node:zlib and scans the workbook XML for cell text: no dependency to audit, and nothing
 * beyond text is interpreted (no formulas, styles or dates).
 */
import { inflateRawSync } from 'node:zlib';

export class XlsxError extends Error {}

export type XlsxRow = { /** The row number the spreadsheet shows. */ line: number; cells: string[] };
export type XlsxSheet = { name: string; hidden: boolean; rows: () => Generator<XlsxRow> };

// A workbook part larger than this is refused rather than inflated (zip bombs).
const MAX_PART_BYTES = 256 * 1024 * 1024;
// Excel's own limits (columns A to XFD, rows 1 to 1,048,576). A reference beyond them comes from a
// damaged or hostile file: "ZZZZZZ1" alone would ask for 321 million empty cells.
const MAX_COLUMNS = 16_384;
const MAX_ROWS = 1_048_576;

type ZipEntry = { method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

function zipEntries(file: Buffer): Map<string, ZipEntry> {
  // The end-of-central-directory record sits in the last 22 bytes plus an optional comment.
  let end = -1;
  for (let at = file.length - 22; at >= Math.max(0, file.length - 22 - 0xffff); at--) {
    if (file.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new XlsxError('This is not an Excel (.xlsx) file.');
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new XlsxError('This Excel file is too large to read (ZIP64).');

  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index++) {
    if (at + 46 > file.length || file.readUInt32LE(at) !== 0x02014b50) throw new XlsxError('This Excel file is damaged.');
    const nameLength = file.readUInt16LE(at + 28);
    entries.set(file.toString('utf8', at + 46, at + 46 + nameLength), {
      method: file.readUInt16LE(at + 10),
      compressedSize: file.readUInt32LE(at + 20),
      uncompressedSize: file.readUInt32LE(at + 24),
      localOffset: file.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
  }
  return entries;
}

function partText(file: Buffer, entries: Map<string, ZipEntry>, name: string): string | null {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.uncompressedSize > MAX_PART_BYTES) throw new XlsxError(`This Excel file has a part larger than ${MAX_PART_BYTES / 1024 / 1024} MB.`);
  const local = entry.localOffset;
  if (local + 30 > file.length || file.readUInt32LE(local) !== 0x04034b50) throw new XlsxError('This Excel file is damaged.');
  const start = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
  const data = file.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.toString('utf8');
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString('utf8');
  throw new XlsxError(`This Excel file uses an unsupported compression method (${entry.method}).`);
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML character references, and Excel's own _xHHHH_ escapes for control characters. */
function decodeXml(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, code: string) => {
      if (!code.startsWith('#')) return XML_ENTITIES[code.toLowerCase()] ?? match;
      const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

const attributePatterns = new Map<string, RegExp>();

function attribute(attributes: string, name: string): string | null {
  let pattern = attributePatterns.get(name);
  if (!pattern) attributePatterns.set(name, (pattern = new RegExp(`(?:^|\\s)${name}="([^"]*)"`)));
  const match = pattern.exec(attributes);
  return match ? decodeXml(match[1]!) : null;
}

type XmlElement = { attributes: string; body: string; start: number; end: number };
const NAME_END = new Set([' ', '\t', '\n', '\r', '>', '/']);

/**
 * Each <tag …>body</tag> or <tag …/>, in order. Found with indexOf, so reading stays linear even
 * in a damaged file, where a lazy regex would rescan to the end for every unclosed tag. The
 * elements read this way (rows, cells, strings) don't nest in themselves.
 */
function* elements(xml: string, tag: string): Generator<XmlElement> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let at = xml.indexOf(open);
  while (at !== -1) {
    if (!NAME_END.has(xml[at + open.length] ?? '')) {
      at = xml.indexOf(open, at + open.length); // a longer name, such as <cols> for <c
      continue;
    }
    const tagEnd = xml.indexOf('>', at);
    if (tagEnd === -1) throw new XlsxError('This Excel file is damaged.');
    if (xml[tagEnd - 1] === '/') {
      yield { attributes: xml.slice(at + open.length, tagEnd - 1), body: '', start: at, end: tagEnd + 1 };
      at = xml.indexOf(open, tagEnd + 1);
      continue;
    }
    const closeAt = xml.indexOf(close, tagEnd + 1);
    if (closeAt === -1) throw new XlsxError('This Excel file is damaged.');
    yield { attributes: xml.slice(at + open.length, tagEnd), body: xml.slice(tagEnd + 1, closeAt), start: at, end: closeAt + close.length };
    at = xml.indexOf(open, closeAt + close.length);
  }
}

/** The text between the first `open` and the `close` after it, if both are there. */
function between(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;
  const end = text.indexOf(close, start + open.length);
  return end === -1 ? null : text.slice(start + open.length, end);
}

/** The text of every <t> element, skipping phonetic guides (<rPh>). */
function textOf(xml: string): string {
  let visible = '';
  let at = 0;
  for (const guide of elements(xml, 'rPh')) {
    visible += xml.slice(at, guide.start);
    at = guide.end;
  }
  visible += xml.slice(at);
  let text = '';
  for (const t of elements(visible, 't')) text += decodeXml(t.body);
  return text;
}

function columnIndex(reference: string): number | null {
  const letters = /^[A-Z]+/.exec(reference)?.[0];
  if (!letters) return null;
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
    if (index > MAX_COLUMNS) throw new XlsxError('This Excel file refers to a column beyond XFD.');
  }
  return index - 1;
}

function* sheetRows(xml: string, shared: string[]): Generator<XlsxRow> {
  let previousLine = 0;
  for (const row of elements(xml, 'row')) {
    const line = Number(attribute(row.attributes, 'r')) || previousLine + 1;
    if (!Number.isInteger(line) || line < 1 || line > MAX_ROWS) throw new XlsxError('This Excel file refers to a row outside 1 to 1,048,576.');
    previousLine = line;
    const cells: string[] = [];
    let next = 0;
    for (const cell of elements(row.body, 'c')) {
      const reference = attribute(cell.attributes, 'r');
      const index = (reference ? columnIndex(reference) : null) ?? next;
      if (index >= MAX_COLUMNS) throw new XlsxError('This Excel file refers to a column beyond XFD.');
      next = index + 1;
      const type = attribute(cell.attributes, 't');
      const body = cell.body;
      let value: string;
      if (type === 'inlineStr') value = textOf(between(body, '<is>', '</is>') ?? '');
      else {
        const raw = between(body, '<v>', '</v>') ?? '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
        else value = decodeXml(raw);
      }
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    yield { line, cells };
  }
}

/** The workbook's sheets, in tab order. Rows are read when you iterate them. */
export function readXlsx(file: Buffer): XlsxSheet[] {
  const entries = zipEntries(file);
  const workbook = partText(file, entries, 'xl/workbook.xml');
  const relationships = partText(file, entries, 'xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) throw new XlsxError('This is not an Excel workbook (no xl/workbook.xml).');

  const targets = new Map<string, string>();
  for (const relationship of elements(relationships, 'Relationship')) {
    const id = attribute(relationship.attributes, 'Id');
    const target = attribute(relationship.attributes, 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }

  const sharedXml = partText(file, entries, 'xl/sharedStrings.xml') ?? '';
  const shared = [...elements(sharedXml, 'si')].map((item) => textOf(item.body));

  return [...elements(workbook, 'sheet')].map((sheet) => {
    const name = attribute(sheet.attributes, 'name') ?? 'Sheet';
    const relationship = /\s[\w]+:id="([^"]*)"/.exec(sheet.attributes)?.[1];
    const path = relationship ? targets.get(relationship) : undefined;
    if (!path) throw new XlsxError(`Sheet "${name}" is missing from this Excel file.`);
    return {
      name,
      hidden: (attribute(sheet.attributes, 'state') ?? 'visible') !== 'visible',
      rows: () => {
        const xml = partText(file, entries, path);
        if (xml === null) throw new XlsxError(`Sheet "${name}" is missing from this Excel file.`);
        return sheetRows(xml, shared);
      },
    };
  });
}
