// Bundles the API server (TypeScript + the shared src/shared code) into plain ESM for Node.
// npm packages stay external: production installs them with `pnpm install --prod`.
import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const outdir = 'server-dist';

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: {
    index: 'server/index.ts',
    migrate: 'server/migrate-cli.ts',
    worker: 'server/worker-cli.ts',
    admin: 'server/admin-cli.ts',
    directory: 'server/directory-cli.ts',
    'push-keys': 'server/vapid-cli.ts',
  },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
// migrate.ts reads SQL files relative to the bundle.
await cp('server/migrations', `${outdir}/migrations`, { recursive: true });
console.log(`Server built to ${outdir}/`);
