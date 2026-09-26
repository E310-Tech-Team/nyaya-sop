import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { serviceWorker } from './scripts/vite-pwa';

/**
 * Social-card tags need absolute URLs. When SITE_URL is set at build time
 * (e.g. https://apply.example.org) the OG image becomes absolute and og:url is added.
 */
function siteUrlMeta(siteUrl: string | undefined): Plugin {
  const base = siteUrl?.trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\/[^/\s]+$/.test(base)) {
    throw new Error(`SITE_URL must look like https://example.org (got "${siteUrl}")`);
  }
  return {
    name: 'site-url-meta',
    transformIndexHtml(html) {
      if (!base) return html;
      return {
        html: html.replace(/content="\/og-image\.jpg"/g, `content="${base}/og-image.jpg"`),
        tags: [{ tag: 'meta', attrs: { property: 'og:url', content: `${base}/` }, injectTo: 'head' }],
      };
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // Loads .env files; only VITE_* values are exposed to browser code.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  // The dev API (server/dev.ts) listens on API_PORT, default 3000.
  const apiTarget = `http://127.0.0.1:${env.API_PORT || 3000}`;
  // One id per release (CI can pass BUILD_ID, e.g. the commit): the page, service worker and server share it.
  const buildId =
    command === 'build' ? env.BUILD_ID?.trim() || `${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}` : 'dev';
  // Emergency rollback (DEPLOYMENT.md): a build whose service worker and page remove any installed worker.
  const killSwitch = env.SW_KILL_SWITCH === '1';

  return {
    plugins: [react(), tailwindcss(), siteUrlMeta(env.SITE_URL), serviceWorker({ buildId, killSwitch })],
    define: {
      __APP_BUILD__: JSON.stringify(buildId),
      __SW_ENABLED__: JSON.stringify(!killSwitch),
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: { '/api': apiTarget },
    },
    preview: {
      port: 4173,
      proxy: { '/api': apiTarget },
    },
  };
});
