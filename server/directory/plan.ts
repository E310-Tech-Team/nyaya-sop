/**
 * Works out what an import would change, without touching the database: the whole of a dry run
 * and the first half of an apply (docs/05 §2, "Parish directory"). Pure, so it's tested without
 * Postgres.
 *
 * Rules, in the order they apply:
 *  - Names are cleaned (src/shared/directory.ts). A row missing any of its four values is skipped.
 *  - A region that repeats its continent's name, or a province that repeats its region's or
 *    continent's name, isn't a level: the parish sits directly under the level above.
 *  - Continents, regions and provinces are recognised by name (unique across the church);
 *    parishes by their unit plus name. Rows with the same unit and name are one entry.
 *  - A parish missing from its old province but listed under the same name in a province
 *    created from it (unit_lineage) has moved: it keeps its ID and its history.
 *  - Anything the source no longer lists is deactivated, never deleted. Entries staff added
 *    themselves (origin 'staff') are left alone, and so are merges staff made.
 *  - Corrections staff made to an entry (its `staff_fields`: a new name, unit, parent, state or
 *    status) are kept, and each place the source differs is listed (`staff_override`). A parish
 *    staff moved is still recognised where the source lists it (`source_unit_id`).
 */
import { randomUUID } from 'node:crypto';
import {
  CHURCH_LEVELS,
  cleanName,
  displayName,
  parishKey,
  stateFromProvince,
  unitKey,
  type ChurchLevel,
} from '../../src/shared/directory';
import type { SourceRow } from './source';

export type DirectoryStatus = 'active' | 'inactive' | 'merged';
export type DirectoryOrigin = 'import' | 'staff';

export type UnitRecord = {
  id: string;
  level: ChurchLevel;
  official_name: string;
  display_name: string;
  name_key: string;
  parent_id: string | null;
  parent_level: ChurchLevel | null;
  state: string | null;
  status: DirectoryStatus;
  merged_into_id: string | null;
  origin: DirectoryOrigin;
  /** Corrected by staff, so imports keep them: 'display_name', 'parent', 'state'. */
  staff_fields?: string[];
};

export type ParishRecord = {
  id: string;
  unit_id: string;
  official_name: string;
  display_name: string;
  name_key: string;
  listed_rows: number;
  status: DirectoryStatus;
  merged_into_id: string | null;
  origin: DirectoryOrigin;
  /** Corrected by staff, so imports keep them: 'display_name', 'unit_id', 'status'. */
  staff_fields?: string[];
  /** Where the source lists a parish that staff moved to `unit_id`. */
  source_unit_id?: string | null;
};

export type LineageRecord = { level: ChurchLevel; new_key: string; source_level: ChurchLevel; source_key: string };

/** The directory as it stands: what an import is compared against. */
export type Snapshot = {
  units: UnitRecord[];
  parishes: ParishRecord[];
  aliases: { parish_id: string; alias: string }[];
  lineage: LineageRecord[];
};

export type ChangeKind = 'create' | 'update' | 'move' | 'reactivate' | 'deactivate';

/** The fields an import may change: a change stores them in full, before and after, so it can be undone. */
export type UnitFields = Pick<UnitRecord, 'official_name' | 'display_name' | 'parent_id' | 'parent_level' | 'state' | 'status'>;
export type ParishFields = Pick<ParishRecord, 'unit_id' | 'official_name' | 'display_name' | 'listed_rows' | 'status'>;

export type UnitChange = { kind: ChangeKind; id: string; level: ChurchLevel; name_key: string; before: UnitFields | null; after: UnitFields };
export type ParishChange = { kind: ChangeKind; id: string; name_key: string; before: ParishFields | null; after: ParishFields };
export type AliasAddition = { parish_id: string; alias: string; alias_key: string };

export type IssueCode =
  | 'missing_value'
  | 'duplicate_name'
  | 'no_province'
  | 'province_without_state'
  | 'unit_parent_conflict'
  | 'ambiguous_move'
  | 'merged_entry'
  | 'kept_unit'
  | 'large_drop'
  | 'staff_override';

export type Issue = {
  severity: 'info' | 'warning' | 'error';
  code: IssueCode;
  /** The source row, when one row is the cause. */
  line: number | null;
  message: string;
  details: Record<string, unknown>;
};

type Tally = Record<ChangeKind | 'unchanged', number>;

export type PlanCounts = {
  rows: number;
  skippedRows: number;
  /** Parish entries after rows with the same unit and name are counted once. */
  entries: number;
  duplicateGroups: number;
  duplicateRows: number;
  noProvince: number;
  provincesWithoutState: number;
  /** Units the source names, per level. */
  levels: Record<'continent' | 'region' | 'province', number>;
  /** Values the cleaning changed. */
  cleaned: { entities: number; apostrophes: number; spacing: number };
  units: Tally;
  parishes: Tally;
  aliases: number;
};

export type Plan = {
  counts: PlanCounts;
  units: UnitChange[];
  parishes: ParishChange[];
  aliases: AliasAddition[];
  issues: Issue[];
};

// Deactivating more than this share of the active parishes needs a second look (a truncated file?).
const LARGE_DROP_SHARE = 0.05;

const LEVEL_INDEX = new Map<ChurchLevel, number>(CHURCH_LEVELS.map((level, index) => [level, index]));
const unitRef = (level: ChurchLevel, key: string) => `${level}:${key}`;
const tally = (): Tally => ({ create: 0, update: 0, move: 0, reactivate: 0, deactivate: 0, unchanged: 0 });

function bump<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** The most frequent key; ties go to the one seen first. */
function mostCommon<K>(counts: Map<K, number>): K {
  let best: K | undefined;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best as K;
}

/** Follows staff merges to the entry that survived. */
function survivor<T extends { id: string; status: DirectoryStatus; merged_into_id: string | null }>(record: T, byId: Map<string, T>): T {
  let current = record;
  for (let hops = 0; current.status === 'merged' && current.merged_into_id && hops < 10; hops++) {
    const next = byId.get(current.merged_into_id);
    if (!next) break;
    current = next;
  }
  return current;
}

const unitFields = (unit: UnitRecord): UnitFields => ({
  official_name: unit.official_name,
  display_name: unit.display_name,
  parent_id: unit.parent_id,
  parent_level: unit.parent_level,
  state: unit.state,
  status: unit.status,
});

const parishFields = (parish: ParishRecord): ParishFields => ({
  unit_id: parish.unit_id,
  official_name: parish.official_name,
  display_name: parish.display_name,
  listed_rows: parish.listed_rows,
  status: parish.status,
});

function unitChangeKind(before: UnitFields, after: UnitFields): ChangeKind | null {
  if (before.status !== after.status) return 'reactivate';
  if (before.parent_id !== after.parent_id) return 'move';
  if (before.official_name !== after.official_name || before.display_name !== after.display_name || before.state !== after.state) return 'update';
  return null;
}

function parishChangeKind(before: ParishFields, after: ParishFields): ChangeKind | null {
  if (before.status !== after.status) return after.status === 'active' ? 'reactivate' : 'deactivate';
  if (before.unit_id !== after.unit_id) return 'move';
  if (before.official_name !== after.official_name || before.display_name !== after.display_name || before.listed_rows !== after.listed_rows) return 'update';
  return null;
}

/** What staff corrected stays as they set it. Returns the fields where the source differs. */
function keepUnitCorrections(existing: UnitRecord, after: UnitFields): { after: UnitFields; kept: string[] } {
  const corrected = new Set(existing.staff_fields ?? []);
  const next = { ...after };
  const kept: string[] = [];
  if (corrected.has('display_name')) {
    if (next.display_name !== existing.display_name) kept.push('name');
    next.display_name = existing.display_name;
  }
  if (corrected.has('parent')) {
    if (next.parent_id !== existing.parent_id) kept.push('parent');
    next.parent_id = existing.parent_id;
    next.parent_level = existing.parent_level;
  }
  if (corrected.has('state')) {
    if (next.state !== existing.state) kept.push('state');
    next.state = existing.state;
  }
  return { after: next, kept };
}

function keepParishCorrections(existing: ParishRecord, after: ParishFields): { after: ParishFields; kept: string[] } {
  const corrected = new Set(existing.staff_fields ?? []);
  const next = { ...after };
  const kept: string[] = [];
  if (corrected.has('display_name')) {
    if (next.display_name !== existing.display_name) kept.push('name');
    next.display_name = existing.display_name;
  }
  if (corrected.has('unit_id')) {
    if (next.unit_id !== existing.unit_id) kept.push('place');
    next.unit_id = existing.unit_id;
  }
  if (corrected.has('status')) {
    if (next.status !== existing.status) kept.push('status');
    next.status = existing.status;
  }
  return { after: next, kept };
}

const listWords = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

function overrideIssue(name: string, kept: string[], line: number | null, where: string | null): Issue {
  return {
    severity: 'info',
    code: 'staff_override',
    line,
    message: `${name}${where ? ` (${where})` : ''}: staff corrected its ${listWords(kept)} and the source still differs, so staff’s version was kept.`,
    details: { name, fields: kept, ...(where ? { unit: where } : {}) },
  };
}

type UsedUnit = { level: ChurchLevel; key: string; names: Map<string, number>; parents: Map<string | null, number>; firstLine: number };
type Group = { unitRef: string; key: string; names: Map<string, number>; lines: number[] };

export function planImport(rows: SourceRow[], current: Snapshot, newId: () => string = randomUUID): Plan {
  const issues: Issue[] = [];
  const cleaned = { entities: 0, apostrophes: 0, spacing: 0 };
  const used = new Map<string, UsedUnit>();
  const groups = new Map<string, Group>();
  let skippedRows = 0;

  // 1. Clean the rows and collect the units and parish entries they name.
  for (const row of rows) {
    const raw = [row.continent, row.region, row.province, row.parish];
    for (const text of raw) {
      if (/&(#x[0-9a-f]+|#\d+|[a-z]+);/i.test(text)) cleaned.entities++;
      if (/[\\`‘’]/.test(text)) cleaned.apostrophes++;
      if (text !== text.trim() || /\s{2,}|\t/.test(text)) cleaned.spacing++;
    }
    const [continent, region, province, parish] = raw.map(cleanName) as [string, string, string, string];
    const missing = (['continent', 'region', 'province', 'parish'] as const).filter((_column, index) => ![continent, region, province, parish][index]);
    if (missing.length) {
      skippedRows++;
      issues.push({
        severity: 'error',
        code: 'missing_value',
        line: row.line,
        message: `Row ${row.line} has no ${missing.join(' or ')}, so it was skipped.`,
        details: { missing },
      });
      continue;
    }

    const chain: { level: ChurchLevel; key: string; name: string }[] = [{ level: 'continent', key: unitKey(continent), name: continent }];
    const regionKey = unitKey(region);
    if (regionKey !== chain[0]!.key) chain.push({ level: 'region', key: regionKey, name: region });
    const provinceKey = unitKey(province);
    if (!chain.some((unit) => unit.key === provinceKey)) chain.push({ level: 'province', key: provinceKey, name: province });

    let parent: string | null = null;
    for (const unit of chain) {
      const ref = unitRef(unit.level, unit.key);
      let entry = used.get(ref);
      if (!entry) used.set(ref, (entry = { level: unit.level, key: unit.key, names: new Map(), parents: new Map(), firstLine: row.line }));
      bump(entry.names, unit.name);
      bump(entry.parents, parent);
      parent = ref;
    }

    const key = parishKey(parish);
    const groupRef = `${parent}|${key}`;
    let group = groups.get(groupRef);
    if (!group) groups.set(groupRef, (group = { unitRef: parent!, key, names: new Map(), lines: [] }));
    bump(group.names, parish);
    group.lines.push(row.line);
  }

  // 2. Units, parents first: create what's new, update what changed.
  const existingUnits = new Map(current.units.map((unit) => [unitRef(unit.level, unit.name_key), unit]));
  const unitsById = new Map(current.units.map((unit) => [unit.id, unit]));
  const unitIds = new Map<string, string>();
  const unitNames = new Map<string, string>(); // unit id → display name, for messages
  for (const unit of current.units) unitNames.set(unit.id, unit.display_name);
  const touchedUnits = new Set<string>();
  const unitChanges: UnitChange[] = [];
  const unitTally = tally();
  const levels = { continent: 0, region: 0, province: 0 };
  let provincesWithoutState = 0;

  const ordered = [...used.entries()].sort(
    ([, a], [, b]) => LEVEL_INDEX.get(a.level)! - LEVEL_INDEX.get(b.level)! || a.firstLine - b.firstLine,
  );
  for (const [ref, unit] of ordered) {
    if (unit.level === 'continent' || unit.level === 'region' || unit.level === 'province') levels[unit.level]++;
    const official = mostCommon(unit.names);
    const parentRef = mostCommon(unit.parents);
    if (unit.parents.size > 1) {
      issues.push({
        severity: 'warning',
        code: 'unit_parent_conflict',
        line: unit.firstLine,
        message: `${displayName(official)} is listed under more than one parent; it was placed under ${
          parentRef ? displayName(mostCommon(used.get(parentRef)!.names)) : 'nothing'
        }, which most rows give.`,
        details: {
          unit: displayName(official),
          parents: [...unit.parents].map(([parent, count]) => ({
            parent: parent ? displayName(mostCommon(used.get(parent)!.names)) : null,
            rows: count,
          })),
        },
      });
    }
    let after: UnitFields = {
      official_name: official,
      display_name: displayName(official),
      parent_id: parentRef ? unitIds.get(parentRef)! : null,
      parent_level: parentRef ? used.get(parentRef)!.level : null,
      state: unit.level === 'province' ? stateFromProvince(official) : null,
      status: 'active',
    };
    const existing = existingUnits.get(ref);
    if (existing && survivor(existing, unitsById) === existing) {
      const corrected = keepUnitCorrections(existing, after);
      after = corrected.after;
      if (corrected.kept.length) issues.push(overrideIssue(existing.display_name, corrected.kept, unit.firstLine, null));
    }
    if (unit.level === 'province' && !after.state) {
      provincesWithoutState++;
      issues.push({
        severity: 'info',
        code: 'province_without_state',
        line: unit.firstLine,
        message: `${after.display_name} doesn't start with a state's name, so it isn't linked to a state.`,
        details: { province: after.display_name },
      });
    }

    if (!existing) {
      const id = newId();
      unitIds.set(ref, id);
      unitNames.set(id, after.display_name);
      unitChanges.push({ kind: 'create', id, level: unit.level, name_key: unit.key, before: null, after });
      unitTally.create++;
      continue;
    }
    const target = survivor(existing, unitsById);
    unitIds.set(ref, target.id);
    touchedUnits.add(target.id);
    if (target !== existing) {
      issues.push({
        severity: 'info',
        code: 'merged_entry',
        line: unit.firstLine,
        message: `${existing.display_name} was merged into ${target.display_name}, so its rows count there.`,
        details: { merged: existing.display_name, into: target.display_name },
      });
      continue;
    }
    const before = unitFields(existing);
    const kind = unitChangeKind(before, after);
    if (kind) {
      unitChanges.push({ kind, id: existing.id, level: existing.level, name_key: existing.name_key, before, after });
      unitTally[kind]++;
      unitNames.set(existing.id, after.display_name);
    } else unitTally.unchanged++;
  }

  // 3. Parish entries: match within the unit, then look for moves, then create. A parish is
  // recognised where the source lists it: its unit (or the unit that one was merged into), or
  // for a parish staff moved, the unit it came from. Where staff put it counts too, in case the
  // source catches up with the correction.
  const unitSurvivorId = (id: string) => {
    const unit = unitsById.get(id);
    return unit ? survivor(unit, unitsById).id : id;
  };
  const sourceUnitOf = (parish: ParishRecord) => unitSurvivorId(parish.source_unit_id ?? parish.unit_id);
  const existingParishes = new Map<string, ParishRecord>();
  const placedParishes = new Map<string, ParishRecord>();
  for (const parish of current.parishes) {
    const key = `${sourceUnitOf(parish)}|${parish.name_key}`;
    const other = existingParishes.get(key);
    // A merged entry and the one it was merged into can share a key: the survivor answers for both.
    if (!other || (other.status === 'merged' && parish.status !== 'merged')) existingParishes.set(key, parish);
    if (parish.source_unit_id && parish.source_unit_id !== parish.unit_id) placedParishes.set(`${parish.unit_id}|${parish.name_key}`, parish);
  }
  const parishesById = new Map(current.parishes.map((parish) => [parish.id, parish]));
  const matched = new Map<string, 'source' | 'placed'>(); // how each entry was recognised
  const knownAliases = new Map<string, Set<string>>();
  for (const { parish_id, alias } of current.aliases) {
    let set = knownAliases.get(parish_id);
    if (!set) knownAliases.set(parish_id, (set = new Set()));
    set.add(alias);
  }
  const seen = new Set<string>();
  const parishChanges: ParishChange[] = [];
  const parishTally = tally();
  const aliases: AliasAddition[] = [];
  let duplicateGroups = 0;
  let duplicateRows = 0;
  let noProvince = 0;

  const addAliases = (parishId: string, names: Iterable<string>, official: string) => {
    let known = knownAliases.get(parishId);
    if (!known) knownAliases.set(parishId, (known = new Set()));
    for (const name of names) {
      if (name === official || known.has(name)) continue;
      known.add(name);
      aliases.push({ parish_id: parishId, alias: name, alias_key: parishKey(name) });
    }
  };

  /** Records what the source changes on an existing entry, keeping staff corrections. */
  const changeParish = (existing: ParishRecord, source: ParishFields, line: number) => {
    const { after, kept } = keepParishCorrections(existing, source);
    if (kept.length) issues.push(overrideIssue(existing.display_name, kept, line, unitNames.get(source.unit_id) ?? null));
    const before = parishFields(existing);
    const kind = parishChangeKind(before, after);
    if (kind) {
      parishChanges.push({ kind, id: existing.id, name_key: existing.name_key, before, after });
      parishTally[kind]++;
    } else parishTally.unchanged++;
  };

  const pending: { group: Group; after: ParishFields }[] = [];
  for (const group of groups.values()) {
    const unitId = unitIds.get(group.unitRef)!;
    const official = mostCommon(group.names);
    const after: ParishFields = { unit_id: unitId, official_name: official, display_name: displayName(official), listed_rows: group.lines.length, status: 'active' };
    const where = unitNames.get(unitId)!;
    if (group.lines.length > 1) {
      duplicateGroups++;
      duplicateRows += group.lines.length;
      issues.push({
        severity: 'warning',
        code: 'duplicate_name',
        line: group.lines[0]!,
        message: `${group.lines.length} rows list ${after.display_name} under ${where}; they are one entry until RCCG confirms otherwise.`,
        details: { unit: where, name: after.display_name, lines: group.lines, spellings: [...group.names.keys()] },
      });
    }
    if (used.get(group.unitRef)!.level !== 'province') {
      noProvince++;
      issues.push({
        severity: 'info',
        code: 'no_province',
        line: group.lines[0]!,
        message: `${after.display_name} has no province; it sits directly under ${where}.`,
        details: { unit: where, name: after.display_name },
      });
    }

    const bySource = existingParishes.get(`${unitId}|${group.key}`);
    const existing = bySource ?? placedParishes.get(`${unitId}|${group.key}`);
    if (!existing) {
      pending.push({ group, after });
      continue;
    }
    const target = survivor(existing, parishesById);
    seen.add(existing.id);
    seen.add(target.id);
    if (target !== existing) {
      issues.push({
        severity: 'info',
        code: 'merged_entry',
        line: group.lines[0]!,
        message: `${existing.display_name} (${where}) was merged into ${target.display_name}, so its rows count there.`,
        details: { merged: existing.display_name, into: target.display_name, unit: where },
      });
      continue;
    }
    // A second listing for an entry already matched: two units staff merged both list the name
    // (its rows count there), or the source lists it both where it was and where staff moved it.
    const earlier = matched.get(existing.id);
    if (earlier) {
      const moved = earlier === 'placed' || !bySource;
      issues.push({
        severity: moved ? 'warning' : 'info',
        code: moved ? 'staff_override' : 'merged_entry',
        line: group.lines[0]!,
        message: moved
          ? `${after.display_name} is listed under ${where} and also where staff moved it; it stays one entry. Check it in the directory.`
          : `${after.display_name} is listed again under a unit merged into ${where}, so its rows count there.`,
        details: { name: after.display_name, unit: where },
      });
      continue;
    }
    matched.set(existing.id, bySource ? 'source' : 'placed');
    changeParish(existing, after, group.lines[0]!);
    addAliases(existing.id, [...group.names.keys(), existing.official_name], after.official_name);
  }

  // Moves: a parish still active in a unit that the new unit was created from, under the same
  // name, and not listed there any more. Only one-to-one matches move; anything ambiguous is
  // created new and reported, so nobody's history is attached to the wrong parish.
  const sourcesOf = new Map<string, Set<string>>();
  for (const link of current.lineage) {
    const source = existingUnits.get(unitRef(link.source_level, link.source_key));
    if (!source) continue;
    const ref = unitRef(link.level, link.new_key);
    let set = sourcesOf.get(ref);
    if (!set) sourcesOf.set(ref, (set = new Set()));
    set.add(survivor(source, unitsById).id);
  }
  const unseenByKey = new Map<string, ParishRecord[]>();
  for (const parish of current.parishes) {
    if (parish.status !== 'active' || seen.has(parish.id)) continue;
    const list = unseenByKey.get(parish.name_key);
    if (list) list.push(parish);
    else unseenByKey.set(parish.name_key, [parish]);
  }
  const candidates = pending.map(({ group }) => {
    const sources = sourcesOf.get(group.unitRef);
    return sources ? (unseenByKey.get(group.key) ?? []).filter((parish) => sources.has(sourceUnitOf(parish))) : [];
  });
  const claims = new Map<string, number>();
  for (const list of candidates) for (const parish of list) bump(claims, parish.id);

  pending.forEach(({ group, after }, index) => {
    const options = candidates[index]!;
    const only = options.length === 1 && claims.get(options[0]!.id) === 1 ? options[0]! : null;
    if (only) {
      seen.add(only.id);
      matched.set(only.id, 'source');
      changeParish(only, after, group.lines[0]!);
      addAliases(only.id, [...group.names.keys(), only.official_name], after.official_name);
      return;
    }
    if (options.length) {
      issues.push({
        severity: 'warning',
        code: 'ambiguous_move',
        line: group.lines[0]!,
        message: `${after.display_name} in ${unitNames.get(after.unit_id)} could have moved from more than one place, so it was added as a new parish. Check it in the directory.`,
        details: { name: after.display_name, unit: unitNames.get(after.unit_id), from: options.map((parish) => unitNames.get(parish.unit_id)) },
      });
    }
    const id = newId();
    parishChanges.push({ kind: 'create', id, name_key: group.key, before: null, after });
    parishTally.create++;
    addAliases(id, group.names.keys(), after.official_name);
  });

  // 4. Deactivate what the source no longer lists (never what staff added).
  const activeBefore = current.parishes.filter((parish) => parish.status === 'active').length;
  for (const parish of current.parishes) {
    if (parish.status !== 'active' || seen.has(parish.id) || parish.origin === 'staff') continue;
    // Staff set its status themselves (reactivated it), so it stays until they change it.
    if (parish.staff_fields?.includes('status')) continue;
    const before = parishFields(parish);
    parishChanges.push({ kind: 'deactivate', id: parish.id, name_key: parish.name_key, before, after: { ...before, status: 'inactive' } });
    parishTally.deactivate++;
  }
  if (activeBefore && parishTally.deactivate / activeBefore > LARGE_DROP_SHARE) {
    issues.push({
      severity: 'warning',
      code: 'large_drop',
      line: null,
      message: `This would deactivate ${parishTally.deactivate} of ${activeBefore} parishes (${Math.round((parishTally.deactivate / activeBefore) * 100)}%). Check the source is complete before applying it.`,
      details: { deactivated: parishTally.deactivate, active: activeBefore },
    });
  }

  // Units no longer named are deactivated once nothing active remains under them (children first).
  const finalUnitOf = new Map<string, string | null>(); // parish id → unit id, active parishes only
  for (const parish of current.parishes) if (parish.status === 'active') finalUnitOf.set(parish.id, parish.unit_id);
  for (const change of parishChanges) {
    if (change.after.status === 'active') finalUnitOf.set(change.id, change.after.unit_id);
    else finalUnitOf.delete(change.id);
  }
  const busyUnits = new Set(finalUnitOf.values());
  const finalParentOf = new Map<string, string | null>();
  for (const unit of current.units) if (unit.status === 'active') finalParentOf.set(unit.id, unit.parent_id);
  for (const change of unitChanges) finalParentOf.set(change.id, change.after.parent_id);

  const stale = current.units
    .filter((unit) => unit.status === 'active' && !touchedUnits.has(unit.id))
    .sort((a, b) => LEVEL_INDEX.get(b.level)! - LEVEL_INDEX.get(a.level)!);
  for (const unit of stale) {
    const hasActiveChild = [...finalParentOf].some(([id, parent]) => parent === unit.id && id !== unit.id);
    if (unit.origin === 'staff' || busyUnits.has(unit.id) || hasActiveChild) {
      if (unit.origin !== 'staff') {
        issues.push({
          severity: 'info',
          code: 'kept_unit',
          line: null,
          message: `${unit.display_name} isn't in the source any more, but it was kept because active entries are still under it.`,
          details: { unit: unit.display_name },
        });
      }
      continue;
    }
    const before = unitFields(unit);
    unitChanges.push({ kind: 'deactivate', id: unit.id, level: unit.level, name_key: unit.name_key, before, after: { ...before, status: 'inactive' } });
    unitTally.deactivate++;
    finalParentOf.delete(unit.id);
  }

  return {
    counts: {
      rows: rows.length,
      skippedRows,
      entries: groups.size,
      duplicateGroups,
      duplicateRows,
      noProvince,
      provincesWithoutState,
      levels,
      cleaned,
      units: unitTally,
      parishes: parishTally,
      aliases: aliases.length,
    },
    units: unitChanges,
    parishes: parishChanges,
    aliases,
    issues,
  };
}

/** True when applying the plan would change nothing. */
export const planIsEmpty = (plan: Plan) => !plan.units.length && !plan.parishes.length && !plan.aliases.length;
