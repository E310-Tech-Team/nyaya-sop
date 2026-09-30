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

/** The text of every <t> element, skipping phonetic guides (<rPh>). */
function textOf(xml: string): string {
  let text = '';
  for (const match of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    text += decodeXml(match[1] ?? '');
  }
  return text;
}

function columnIndex(reference: string): number | null {
  const letters = /^[A-Z]+/.exec(reference)?.[0];
  if (!letters) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function* sheetRows(xml: string, shared: string[]): Generator<XlsxRow> {
  let previousLine = 0;
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const line = Number(attribute(row[1]!, 'r')) || previousLine + 1;
    previousLine = line;
    const cells: string[] = [];
    let next = 0;
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = attribute(cell[1]!, 'r');
      const index = (reference ? columnIndex(reference) : null) ?? next;
      next = index + 1;
      const type = attribute(cell[1]!, 't');
      const body = cell[2] ?? '';
      let value: string;
      if (type === 'inlineStr') value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
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
  for (const match of relationships.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attribute(match[1]!, 'Id');
    const target = attribute(match[1]!, 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }

  const sharedXml = partText(file, entries, 'xl/sharedStrings.xml') ?? '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((match) => textOf(match[1] ?? ''));

  return [...workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((match) => {
    const name = attribute(match[1]!, 'name') ?? 'Sheet';
    const relationship = /\s[\w]+:id="([^"]*)"/.exec(match[1]!)?.[1];
    const path = relationship ? targets.get(relationship) : undefined;
    if (!path) throw new XlsxError(`Sheet "${name}" is missing from this Excel file.`);
    return {
      name,
      hidden: (attribute(match[1]!, 'state') ?? 'visible') !== 'visible',
      rows: () => {
        const xml = partText(file, entries, path);
        if (xml === null) throw new XlsxError(`Sheet "${name}" is missing from this Excel file.`);
        return sheetRows(xml, shared);
      },
    };
  });
}
