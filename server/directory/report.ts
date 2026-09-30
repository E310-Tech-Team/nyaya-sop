/** How an import plan reads on the command line, and the issues file to send back to RCCG. */
import { toCsv } from '../csv';
import type { Issue, Plan } from './plan';

const n = (value: number) => value.toLocaleString('en-GB');

const tally = (counts: Plan['counts']['units']) =>
  (['create', 'update', 'move', 'reactivate', 'deactivate', 'unchanged'] as const).map((kind) => `${kind} ${n(counts[kind])}`).join(', ');

/** A short summary, with up to three examples of each kind of issue. */
export function planSummary(plan: Plan): string[] {
  const { counts } = plan;
  const lines = [
    `${n(counts.rows)} rows, ${n(counts.entries)} parish entries${counts.skippedRows ? ` (${n(counts.skippedRows)} rows skipped)` : ''}`,
    `In the source: ${n(counts.levels.continent)} continents, ${n(counts.levels.region)} regions, ${n(counts.levels.province)} provinces`,
    `Units:    ${tally(counts.units)}`,
    `Parishes: ${tally(counts.parishes)}`,
    `Same name twice in one unit: ${n(counts.duplicateGroups)} groups (${n(counts.duplicateRows)} rows). No province: ${n(counts.noProvince)}. Provinces without a state: ${n(counts.provincesWithoutState)}.`,
    `Cleaned: ${n(counts.cleaned.entities)} web codes, ${n(counts.cleaned.apostrophes)} apostrophes, ${n(counts.cleaned.spacing)} spacing. New spellings kept as aliases: ${n(counts.aliases)}.`,
  ];
  const byCode = new Map<string, Issue[]>();
  for (const issue of plan.issues) {
    const list = byCode.get(issue.code);
    if (list) list.push(issue);
    else byCode.set(issue.code, [issue]);
  }
  if (byCode.size) lines.push('', 'Issues:');
  for (const [code, list] of byCode) {
    lines.push(`  ${code} (${list[0]!.severity}): ${n(list.length)}`);
    for (const issue of list.slice(0, 3)) lines.push(`    ${issue.line ? `Row ${issue.line}: ` : ''}${issue.message}`);
    if (list.length > 3) lines.push(`    … and ${n(list.length - 3)} more`);
  }
  return lines;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const joined = (value: unknown) => (Array.isArray(value) ? value.join('; ') : '');

/** Every issue, one per line: what to send back to RCCG (the duplicate groups, parishes with no province…). */
export function issuesCsv(issues: Issue[]): string {
  return toCsv(
    ['Severity', 'Issue', 'Row', 'Message', 'Unit', 'Parish', 'Rows', 'Spellings'],
    issues.map((issue) => [
      issue.severity,
      issue.code,
      issue.line,
      issue.message,
      text(issue.details.unit ?? issue.details.province),
      text(issue.details.name),
      joined(issue.details.lines),
      joined(issue.details.spellings),
    ]),
  );
}
