/**
 * The website can be served by Vercel while the API, database and worker stay on the VPS
 * (docs/DEPLOYMENT.md "C. Website on Vercel"). Vercel's middleware (middleware.ts) forwards
 * /api/* to the VPS with these two request headers; the server (server/edge-proxy.ts) believes
 * the visitor's address only when the secret matches its own EDGE_PROXY_SECRET.
 */
export const EDGE_PROXY_SECRET_HEADER = 'x-edge-proxy-secret';
export const EDGE_CLIENT_IP_HEADER = 'x-edge-client-ip';

/**
 * The release id a Vercel build gives its pages (vite.config.ts) and its API responses
 * (middleware.ts): BUILD_ID when set, else the commit Vercel built. Null when neither is known.
 */
export function releaseId(env: { BUILD_ID?: string; VERCEL_GIT_COMMIT_SHA?: string }): string | null {
  return env.BUILD_ID?.trim() || env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) || null;
}
