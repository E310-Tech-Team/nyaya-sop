/**
 * Development entry (`pnpm dev`). The API always listens on API_PORT (default 3000),
 * even if PORT is set in the environment for the Vite dev server. Vite proxies /api here.
 */
process.env.PORT = process.env.API_PORT?.trim() || '3000';
await import('./index');

export {};
