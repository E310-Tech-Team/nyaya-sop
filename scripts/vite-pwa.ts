/**
 * Builds the service worker (src/sw/sw.ts → dist/sw.js) after Vite has written the site, with:
 * - __PRECACHE__: the app shell (index.html, offline page, manifest, icons, the logo lockups)
 *   plus the JS and CSS the first page load needs (the entry chunk and its static imports).
 *   Lazily loaded parts (the admin area, account pages) are cached when first used, never ahead
 *   of time.
 * - __BUILD_ID__: this release's id, also written to dist/build-id.txt. The server sends it with
 *   every API response (x-app-build), so an open page can tell it's out of date.
 * - __KILL_SWITCH__: SW_KILL_SWITCH=1 builds a service worker that removes itself (DEPLOYMENT.md).
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import type { Plugin, ResolvedConfig } from 'vite';

/** Always cached, whatever the build contains. */
const SHELL_FILES = ['/index.html', '/offline.html', '/manifest.webmanifest', '/favicon-32.png', '/icons/icon-192.png', '/icons/badge-96.png'];
/** Bundled images every page shows (the header and footer logos, src/components/BrandLockup.tsx). */
const SHELL_ASSET = /^assets\/brand-lockup-[\w-]+\.webp$/;

export function serviceWorker(options: { buildId: string; killSwitch: boolean }): Plugin {
  let config: ResolvedConfig;
  let firstLoad: string[] = [];

  return {
    name: 'sop-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_output, bundle) {
      const files = new Set<string>();
      const visit = (fileName: string) => {
        const chunk = bundle[fileName];
        if (!chunk || chunk.type !== 'chunk' || files.has(fileName)) return;
        files.add(fileName);
        for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css);
        chunk.imports.forEach(visit);
      };
      for (const item of Object.values(bundle)) if (item.type === 'chunk' && item.isEntry) visit(item.fileName);
      for (const item of Object.values(bundle)) if (item.type === 'asset' && SHELL_ASSET.test(item.fileName)) files.add(item.fileName);
      // Anything index.html itself loads (stylesheets, preloads) belongs to the first load too.
      const html = bundle['index.html'];
      if (html?.type === 'asset') {
        for (const match of String(html.source).matchAll(/(?:href|src)="\/(assets\/[^"]+\.(?:js|css))"/g)) files.add(match[1]!);
      }
      firstLoad = [...files].sort().map((file) => `/${file}`);
    },
    async writeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      await build({
        entryPoints: [resolve(config.root, 'src/sw/sw.ts')],
        outfile: join(outDir, 'sw.js'),
        bundle: true,
        format: 'iife',
        target: ['es2020'],
        minify: true,
        legalComments: 'none',
        define: {
          __BUILD_ID__: JSON.stringify(options.buildId),
          __PRECACHE__: JSON.stringify([...SHELL_FILES, ...firstLoad]),
          __KILL_SWITCH__: JSON.stringify(options.killSwitch),
        },
        logLevel: 'warning',
      });
      await writeFile(join(outDir, 'build-id.txt'), `${options.buildId}\n`);
      config.logger.info(
        `service worker: ${options.killSwitch ? 'KILL SWITCH (removes itself and all caches)' : `${SHELL_FILES.length + firstLoad.length} files precached`}, build ${options.buildId}`,
      );
    },
  };
}
