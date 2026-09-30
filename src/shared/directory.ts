/**
 * The RCCG parish directory, shared by the browser app and the API server (docs/05 §2,
 * "Parish directory"). Keep this module free of DOM, React and Node imports.
 *
 * `CHURCH_LEVELS` is stored in the Postgres enum `church_level`
 * (server/migrations/0006_parish_directory.sql); change both together. The order matters: a
 * unit's parent is always at an earlier level.
 */
import { NIGERIAN_STATES } from './application';

export const CHURCH_LEVELS = ['continent', 'region', 'province', 'zone', 'area'] as const;
export type ChurchLevel = (typeof CHURCH_LEVELS)[number];

/**
 * Levels whose names are unique across the church, so an import recognises them by name
 * alone. Zone and area names repeat ("Zone 2"), so they would be unique within their parent only.
 */
export const NAMED_LEVELS = ['continent', 'region', 'province'] as const satisfies readonly ChurchLevel[];

export type NigerianState = (typeof NIGERIAN_STATES)[number];

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML entities, decoded until stable: the RCCG list has "&amp;", "&AMP;" and even "&amp;amp;". */
function decodeEntities(text: string): string {
  let current = text;
  for (let pass = 0; pass < 4; pass++) {
    const next = current.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code.startsWith('#')) {
        const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return point >= 32 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    });
    if (next === current) return next;
    current = next;
  }
  return current;
}

/**
 * A name as the directory stores it. Decodes HTML entities; turns the export's escaped
 * apostrophes ("GOD\'S", "RULERS \' HOUSE") and curly quotes or backticks into plain
 * apostrophes; drops control characters and the replacement character; collapses spaces and
 * tabs. Capitals stay as the source wrote them.
 */
export function cleanName(raw: string): string {
  return decodeEntities(raw)
    .replace(/\s*\\+'/g, "'")
    .replace(/\\+/g, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f�]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Capitals, accents, apostrophes and punctuation set aside, "&" read as AND. */
function comparable(name: string): string {
  return cleanName(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/'/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** How a unit is recognised: "LAGOS pROVINCE 102" and "Lagos Province 102" are the same province. */
export function unitKey(name: string): string {
  return comparable(name);
}

/**
 * How a parish is recognised within its unit: as a unit, and also without a leading "RCCG"
 * or a trailing "Parish", so "RCCG, DIVINE FAVOUR PARISH" and "DIVINE FAVOUR" are one name.
 */
export function parishKey(name: string): string {
  const full = comparable(name);
  const key = full
    .replace(/^(THE )?(RCCG|R C C G|REDEEMED CHRISTIAN CHURCH OF GOD) /, '')
    .replace(/ PARISH$/, '');
  return key || full;
}

const UPPER_WORDS = new Set(['RCCG', 'FCT', 'HQ', 'HQTRS', 'LP', 'YAYA', 'CAC', 'USA', 'UK']);
const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);
const ROMAN = /^(?=[IVX]+$)X{0,3}(IX|IV|V?I{0,3})$/;

/**
 * Ordinary capitals for display: "JESUS HOUSE" → "Jesus House", "HOUSE OF PRAYER" → "House
 * of Prayer". Keeps acronyms (RCCG, FCT, HQ), Roman numerals ("Christ Chapel II") and ordinals
 * ("2nd"), and treats each part of a hyphenated or bracketed name as a new word.
 */
export function displayName(name: string): string {
  let first = true;
  return cleanName(name).replace(/[A-Za-z0-9']+|[^A-Za-z0-9']+/g, (token) => {
    if (!/[A-Za-z0-9]/.test(token)) {
      if (/[(\[{-]/.test(token)) first = true;
      return token;
    }
    const upper = token.toUpperCase();
    let word: string;
    if (UPPER_WORDS.has(upper) || (ROMAN.test(upper) && upper.length <= 4)) word = upper;
    else if (/^\d+(ST|ND|RD|TH)$/.test(upper)) word = upper.toLowerCase();
    else if (/\d/.test(upper)) word = upper;
    else if (!first && SMALL_WORDS.has(upper.toLowerCase())) word = upper.toLowerCase();
    else word = upper.charAt(0) + upper.slice(1).toLowerCase();
    first = false;
    return word;
  });
}

// ── Parish search and lookup (GET /api/parishes/…) ─────────────────────────────

export const PARISH_SEARCH = { minLength: 2, maxLength: 60, maxResults: 10, maxTerms: 8 } as const;

/** A unit in a parish's chain, as the API returns it. */
export type ChainUnit = { id: string; name: string };
/** Null where the directory has no such level for this parish (zone and area, for now, everywhere). */
export type ParishChain = Record<ChurchLevel, ChainUnit | null>;

export type ParishSuggestion = {
  id: string;
  name: string;
  chain: ParishChain;
  /** The parish's province is in the state the applicant gave. */
  inState: boolean;
};

export type ParishSearchResponse = {
  results: ParishSuggestion[];
  /** Every active parish the search matched, of which `results` are the best few. */
  total: number;
  /** Nothing matched exactly, so these are the closest spellings ("Did you mean…?"). */
  fuzzy: boolean;
};

/** The parish as it stands now: what a saved draft is checked against. */
export type ParishDetailsResponse = {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'merged';
  /** For a merged parish, the one it was merged into. */
  mergedInto: ChainUnit | null;
  chain: ParishChain;
};

/**
 * The words a parish search looks for: capitals and punctuation set aside, "LP 12" read as
 * Lagos Province 12 (RCCG's own shorthand), and "RCCG" and "Parish" dropped unless they are all
 * there is (every entry is an RCCG parish).
 */
export function searchTerms(query: string): string[] {
  const words = comparable(query)
    .replace(/\bLP ?(\d+)\b/g, 'LAGOS PROVINCE $1')
    .replace(/\bLP\b/g, 'LAGOS PROVINCE')
    .split(' ')
    .filter(Boolean);
  const meaningful = words.filter((word) => word !== 'RCCG' && word !== 'PARISH');
  return (meaningful.length ? meaningful : words).slice(0, PARISH_SEARCH.maxTerms);
}

// The state a province is in, read from the start of its name ("LAGOS PROVINCE 12",
// "ADAMAWA PROVINCE", "KWARA 2"). Includes the other spellings the RCCG list uses.
const statePrefix = (text: string, state: NigerianState): [prefix: string, state: NigerianState] => [text, state];
const STATE_PREFIXES = [
  ...NIGERIAN_STATES.filter((state) => state !== 'FCT (Abuja)').map((state) => statePrefix(unitKey(state), state)),
  statePrefix('FCT', 'FCT (Abuja)'),
  statePrefix('ABUJA', 'FCT (Abuja)'),
  statePrefix('CROSS RIVERS', 'Cross River'),
  statePrefix('NASSARAWA', 'Nasarawa'),
].sort((a, b) => b[0].length - a[0].length); // longest first: CROSS RIVERS before CROSS RIVER

/** The state named at the start of a province's name, or null (youth provinces, "PROVINCE 106"). */
export function stateFromProvince(provinceName: string): NigerianState | null {
  const key = unitKey(provinceName);
  for (const [prefix, state] of STATE_PREFIXES) {
    if (key === prefix || key.startsWith(`${prefix} `)) return state;
  }
  return null;
}
