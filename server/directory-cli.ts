/**
 * The RCCG parish directory from the server's shell (docs/DEPLOYMENT.md, "Parish directory"):
 *
 *   pnpm directory import <file.xlsx> [--apply] [--as-at YYYY-MM-DD] [--report issues.csv]
 *       Reads the RCCG parish list (its CONTINENT, REGION, PROVINCE and PARISH columns; any
 *       other column, such as attendance, is ignored) and shows what would change. Nothing
 *       changes without --apply. --as-at records the date the list's structure is correct for.
 *       --report writes every issue (same-name groups, parishes with no province…) to a CSV
 *       for RCCG. Keep both files out of the repository.
 *   pnpm directory revert <import-id>
 *       Undoes the latest applied import.
 *   pnpm directory lineage <file.csv> [--apply]
 *       Records where new units came from, one row per source: level, unit, source, and
 *       optionally source_level (when the source is at another level) and approved_on.
 *   pnpm directory status
 *
 * With the RCCG directory API configured (DIRECTORY_API_ENV, DIRECTORY_API_KEY), the API is the
 * source and the worker keeps the copy current; imports from a spreadsheet are refused:
 *
 *   pnpm directory sync [--force]
 *       Checks the provider's latest release now and applies it if it is new (--force: rebuild
 *       from the releases kept here even when it isn't). Prints figures only, never the key.
 *   pnpm directory api-status
 *   pnpm directory legacy-report [--refresh]
 *       The handover from the spreadsheet: its parishes that applications link to, and the API's
 *       parishes with exactly the same name and chain. Names, codes and counts only. --refresh
 *       compares them again with the current release.
 *
 * In production (built): node server-dist/directory.js import …
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NAMED_LEVELS, cleanName, unitKey, type ChurchLevel } from '../src/shared/directory';
import { ConfigError, loadConfig, loadDotEnv } from './config';
import { parseCsv } from './csv';
import { createDb, type Db } from './db';
import { createDirectoryApi, namespaceOf } from './directory/api';
import { isFresh, refreshLegacyMatches, syncDirectory, syncState } from './directory/api-sync';
import { planImport } from './directory/plan';
import { issuesCsv, planSummary } from './directory/report';
import { spreadsheetSource } from './directory/source';
import { applyPlan, checkConsistency, loadSnapshot, revertImport, saveLineage, type LineageLink } from './directory/store';
import { migrate } from './migrate';

loadDotEnv();
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: 'boolean', default: false },
    'as-at': { type: 'string' },
    report: { type: 'string' },
    force: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
  },
});
const [command, argument] = positionals;

const USAGE =
  'Commands: import <file.xlsx> [--apply] [--as-at YYYY-MM-DD] [--report issues.csv] | revert <import-id> | lineage <file.csv> [--apply] | status | sync [--force] | api-status | legacy-report [--refresh]';

function validDate(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error('--as-at takes a date as YYYY-MM-DD.');
  return value;
}

async function importList(db: Db) {
  if (!argument) throw new Error(USAGE);
  const path = resolve(argument);
  const structureAsAt = validDate(values['as-at']);
  const source = spreadsheetSource(basename(path), await readFile(path));
  const { rows, notes } = await source.read();
  const plan = planImport(rows, await loadSnapshot(db));
  for (const line of [...notes, ...planSummary(plan)]) console.log(line);
  if (values.report) {
    await writeFile(resolve(values.report), issuesCsv(plan.issues));
    console.log(`\nWrote ${plan.issues.length.toLocaleString('en-GB')} issues to ${values.report}. It holds directory names only; keep it out of the repository.`);
  }
  if (!values.apply) {
    console.log('\nDry run: nothing was changed. Run again with --apply to apply it.');
    return;
  }
  const importId = await applyPlan(db, plan, { source: source.kind, label: source.label, checksum: source.checksum, structureAsAt, via: 'cli' });
  console.log(`\nApplied. Import ID: ${importId} (pnpm directory revert ${importId} undoes it).`);
}

async function revert(db: Db) {
  if (!argument) throw new Error(USAGE);
  const result = await revertImport(db, argument);
  console.log(
    `Reverted. Units: ${result.units.restored} restored, ${result.units.deleted} removed. Parishes: ${result.parishes.restored} restored, ${result.parishes.deleted} removed. Aliases removed: ${result.aliases}.`,
  );
}

async function lineage(db: Db) {
  if (!argument) throw new Error(USAGE);
  const [header, ...rows] = parseCsv(await readFile(resolve(argument), 'utf8'));
  const columns = (header ?? []).map((cell) => cell.trim().toLowerCase().replace(/\s+/g, '_'));
  const column = (name: string) => columns.indexOf(name);
  if (column('level') < 0 || column('unit') < 0 || column('source') < 0) throw new Error('The file needs the columns level, unit and source (and optionally source_level and approved_on).');
  const level = (value: string, line: number): ChurchLevel => {
    const clean = value.trim().toLowerCase();
    if (!(NAMED_LEVELS as readonly string[]).includes(clean)) throw new Error(`Line ${line}: the level must be ${NAMED_LEVELS.join(', ')}.`);
    return clean as ChurchLevel;
  };
  const links: LineageLink[] = rows.map((cells, index) => {
    const line = index + 2;
    const cell = (name: string) => (column(name) >= 0 ? (cells[column(name)] ?? '') : '');
    const newName = cleanName(cell('unit'));
    const sourceName = cleanName(cell('source'));
    if (!newName || !sourceName) throw new Error(`Line ${line}: unit and source are required.`);
    const approvedOn = cell('approved_on').trim() || null;
    if (approvedOn && !/^\d{4}-\d{2}-\d{2}$/.test(approvedOn)) throw new Error(`Line ${line}: approved_on takes a date as YYYY-MM-DD.`);
    const newLevel = level(cell('level'), line);
    return {
      level: newLevel,
      newKey: unitKey(newName),
      newName,
      sourceLevel: cell('source_level').trim() ? level(cell('source_level'), line) : newLevel,
      sourceKey: unitKey(sourceName),
      sourceName,
      approvedOn,
    };
  });
  for (const link of links) console.log(`${link.level} ${link.newName} ← ${link.sourceLevel} ${link.sourceName}`);
  if (!values.apply) {
    console.log(`\n${links.length} links. Dry run: nothing was saved. Run again with --apply to save them.`);
    return;
  }
  console.log(`\nSaved ${await saveLineage(db, links)} new links (${links.length} in the file).`);
}

async function status(db: Db) {
  const units = await db.query<{ level: string; status: string; n: number }>(
    `select level::text as level, status::text as status, count(*)::int as n from church_units group by 1, 2 order by 1, 2`,
  );
  const parishes = await db.query<{ status: string; n: number }>(`select status::text as status, count(*)::int as n from parishes group by 1 order by 1`);
  const imports = await db.query<{ id: string; status: string; source_label: string; started_at: Date; structure_as_at: string | null }>(
    `select id, status::text as status, source_label, started_at, structure_as_at::text as structure_as_at
       from directory_imports order by started_at desc limit 5`,
  );
  const lineageCount = (await db.query<{ n: number }>('select count(*)::int as n from unit_lineage')).rows[0]!.n;
  console.log('Units:', units.rows.map((row) => `${row.level} ${row.status} ${row.n}`).join(', ') || 'none');
  console.log('Parishes:', parishes.rows.map((row) => `${row.status} ${row.n}`).join(', ') || 'none');
  console.log(`Lineage links: ${lineageCount}`);
  console.log('Latest imports:');
  for (const row of imports.rows) {
    console.log(`  ${row.started_at.toISOString()} ${row.status.padEnd(8)} ${row.id} ${row.source_label}${row.structure_as_at ? ` (as at ${row.structure_as_at})` : ''}`);
  }
  if (!imports.rows.length) console.log('  none yet');
  console.log('Consistency:', JSON.stringify(await checkConsistency(db)));
}

type Config = ReturnType<typeof loadConfig>;

function apiOf(config: Config) {
  if (!config.directoryApi) throw new Error('The RCCG directory API isn’t configured: set DIRECTORY_API_ENV and DIRECTORY_API_KEY (docs/DEPLOYMENT.md, “Directory API”).');
  return createDirectoryApi({ env: config.directoryApi.env, key: config.directoryApi.key });
}

async function sync(db: Db, config: Config) {
  const result = await syncDirectory(db, apiOf(config), { via: 'cli', force: values.force });
  if (result.status === 'failed') throw new Error(`The sync failed (${result.error}); nothing was changed and the last good state stays in use.`);
  if (result.status === 'current') {
    console.log(`Current: release ${result.release ?? '(none published)'} is the provider's latest. Nothing to apply.`);
    return;
  }
  const { units, parishes, issues, handover, fetchedReleases } = result.counts;
  const line = (name: string, c: typeof units) =>
    `${name}: ${c.created} added, ${c.updated} renamed, ${c.moved} moved, ${c.deactivated} retired, ${c.reactivated} back, ${c.unchanged} unchanged` +
    (c.kept ? `, ${c.kept} kept as they were (the releases don't describe them usably: see the issues)` : '');
  console.log(`Applied release ${result.release} (import ${result.importId}; ${fetchedReleases} release(s) downloaded).`);
  console.log(line('Units', units));
  console.log(line('Parishes', parishes));
  console.log(`Issues for the registry team: ${issues} (Parish directory > Imports lists them).`);
  if (handover) {
    console.log(
      `Handover from the spreadsheet: ${handover.units} units and ${handover.parishes} parishes no longer used; of its parishes with applications, ${handover.matched} have one exact match, ${handover.ambiguous} several, ${handover.unmatched} none (pnpm directory legacy-report).`,
    );
  }
}

async function apiStatus(db: Db, config: Config) {
  const api = apiOf(config);
  const state = await syncState(db, api.namespace);
  console.log(`Environment: ${config.directoryApi!.env} (${api.namespace})`);
  if (!state) {
    console.log('Not synced yet: run pnpm directory sync, or wait for the worker.');
    return;
  }
  console.log(`Release: ${state.releaseVersion ?? 'none'}${state.releaseName ? ` (${state.releaseName})` : ''}`);
  console.log(`Last confirmed current: ${state.checkedAt ?? 'never'} (${isFresh(state, config.directoryApi!.freshnessHours) ? 'fresh' : 'stale: submissions check parishes live'})`);
  console.log(`Last update applied: ${state.syncedAt ?? 'never'}`);
  console.log(`Last problem: ${state.lastError ? `${state.lastError}, ${state.failures} in a row, at ${state.lastErrorAt}` : 'none'}`);
}

async function legacyReport(db: Db, config: Config) {
  const namespace = namespaceOf(apiOf(config).env);
  if (values.refresh) await refreshLegacyMatches(db, namespace);
  const { rows } = await db.query<{ name: string; place: string | null; status: string; applications: number; candidates: string[] | null }>(
    `select p.display_name as name, concat_ws(' · ', v.display_name, r.display_name, c.display_name) as place,
            m.status::text as status, m.applications,
            array(select n.external_id || ' (' || n.display_name || ')' from parishes n where n.id = any (m.candidate_ids) order by n.external_id) as candidates
       from directory_legacy_matches m
       join parishes p on p.id = m.legacy_parish_id
       left join church_units c on c.id = p.continent_id
       left join church_units r on r.id = p.region_id
       left join church_units v on v.id = p.province_id
      where m.namespace = $1
      order by m.status, p.display_name`,
    [namespace],
  );
  if (!rows.length) {
    console.log('No parish from the earlier list has applications: nothing to map.');
    return;
  }
  for (const row of rows) {
    console.log(`${row.status.padEnd(9)} ${row.name} (${row.place || 'no units'}): ${row.applications} application(s)${row.candidates?.length ? ` → ${row.candidates.join(', ')}` : ''}`);
  }
  console.log('\nNothing was relinked. Link applications in the admin area (Applicants > the application > Parish), which keeps each applicant\'s answer.');
}

async function main() {
  const config = loadConfig();
  const db = await createDb(config);
  try {
    await migrate(db);
    if (command === 'import' && config.directoryApi) {
      throw new Error('This server takes the directory from the RCCG directory API (DIRECTORY_API_ENV is set): a spreadsheet can no longer change it.');
    }
    if (command === 'sync') await sync(db, config);
    else if (command === 'api-status') await apiStatus(db, config);
    else if (command === 'legacy-report') await legacyReport(db, config);
    else if (command === 'import') await importList(db);
    else if (command === 'revert') await revert(db);
    else if (command === 'lineage') await lineage(db);
    else if (command === 'status') await status(db);
    else throw new Error(USAGE);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? `Configuration error: ${error.message}` : (error as Error).message);
  process.exit(1);
});
