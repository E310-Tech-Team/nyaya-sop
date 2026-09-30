import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Which code may load what: public pages must not download the admin's component libraries, and
// the reports' heavy parts (charts, date picker, table) load only when shown (src/admin/reports/lazy.tsx).
const SRC = fileURLToPath(new URL('../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const FILES = sources(SRC).map((path) => ({ path: relative(SRC, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));

/** Static (not type-only, not dynamic) imports, resolved to src-relative paths for local files. */
function imports(file: { path: string; text: string }): string[] {
  const found: string[] = [];
  for (const match of file.text.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?'([^']+)'/gm)) {
    const specifier = match[1]!;
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
      found.push(specifier);
      continue;
    }
    const absolute = specifier.startsWith('@/') ? join(SRC, specifier.slice(2)) : resolve(dirname(join(SRC, file.path)), specifier);
    found.push(relative(SRC, absolute).replaceAll('\\', '/').replace(/\.(tsx?|js)$/, ''));
  }
  return found;
}

// lib/utils.ts is the primitives' `cn` helper: public code may not import it (checked below).
const isPublic = (path: string) => !/^(admin|account)\//.test(path) && !path.startsWith('components/ui/') && path !== 'lib/utils.ts';
const ADMIN_LIBRARIES = /^(radix-ui|@radix-ui\/|class-variance-authority|tailwind-merge|clsx|lucide-react|recharts|react-day-picker|@tanstack\/)/;

describe('bundle boundaries', () => {
  it('keeps public pages to the plain basics of the kit, and off the admin component libraries', () => {
    const problems = FILES.filter((file) => isPublic(file.path)).flatMap((file) =>
      imports(file)
        .filter((target) => (target.startsWith('components/ui') && target !== 'components/ui/basic') || ADMIN_LIBRARIES.test(target) || target === 'lib/utils')
        .map((target) => `${file.path} imports ${target}`),
    );
    expect(problems).toEqual([]);
  });

  it('keeps the basics free of the primitives and their libraries', () => {
    const basic = FILES.find((file) => file.path === 'components/ui/basic.tsx')!;
    expect(imports(basic).filter((target) => ADMIN_LIBRARIES.test(target) || (target.startsWith('components/ui/') && target !== 'components/ui/styles') || target === 'lib/utils')).toEqual([]);
  });

  it('loads Recharts, the date picker and TanStack Table only in the parts downloaded on demand', () => {
    const allowed: Record<string, string[]> = {
      recharts: ['components/ui/chart.tsx', 'admin/reports/charts.tsx'],
      'react-day-picker': ['components/ui/calendar.tsx', 'admin/reports/PeriodCalendar.tsx'],
      '@tanstack/react-table': ['admin/reports/PlaceTable.tsx'],
    };
    for (const [library, files] of Object.entries(allowed)) {
      const users = FILES.filter((file) => imports(file).some((target) => target === library || target.startsWith(`${library}/`))).map((file) => file.path);
      expect({ library, users: users.sort() }).toEqual({ library, users: [...files].sort() });
    }
    // Those modules are imported only dynamically, from lazy.tsx.
    for (const lazyModule of ['admin/reports/charts', 'admin/reports/PeriodCalendar', 'admin/reports/PlaceTable', 'components/ui/chart', 'components/ui/calendar']) {
      const importers = FILES.filter((file) => imports(file).includes(lazyModule)).map((file) => file.path);
      const expected = lazyModule === 'components/ui/chart' ? ['admin/reports/charts.tsx'] : lazyModule === 'components/ui/calendar' ? ['admin/reports/PeriodCalendar.tsx'] : [];
      expect({ lazyModule, importers }).toEqual({ lazyModule, importers: expected });
    }
  });
});
