import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, ApiErrorCode } from '../src/shared/application';
import type { AppConfig } from './config';

export function sendError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: Partial<ApiErrorBody> = {},
) {
  return reply.code(status).send({ code, message, ...extra } satisfies ApiErrorBody);
}

export const isUnsafeMethod = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * State-changing requests must come from our own pages. Browsers always send Origin on
 * cross-origin requests and on same-origin POST/PUT/PATCH/DELETE, so a missing or foreign
 * Origin is refused. Together with SameSite=Strict cookies and the CSRF token this stops
 * cross-site request forgery.
 */
export function isAllowedOrigin(request: FastifyRequest, config: AppConfig): boolean {
  const origin = request.headers.origin;
  if (!origin || origin === 'null') return false;
  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  if (config.siteOrigin && origin === config.siteOrigin) return true;
  if (config.env === 'production') return false;
  // Development and tests: the page's own origin (Vite proxies /api with the original Host).
  return origin === `${request.protocol}://${request.headers.host}` || LOCAL_DEV_ORIGIN.test(origin);
}

/** A coarse, non-identifying device description ("Chrome on Android") for session and device lists. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = /EdgA?\/|Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /OPR\/|Opera/.test(ua)
          ? 'Opera'
          : /CriOS\/|Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPad/.test(ua)
      ? 'iPad'
      : /iPhone|iPod/.test(ua)
        ? 'iPhone'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'another device';
  return `${browser} on ${os}`;
}

/** Page through results: page ≥ 1, size capped. */
export function paging(query: { page?: unknown; pageSize?: unknown }, maxSize = 100) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(query.page ?? '1'), 10) || 1));
  const pageSize = Math.max(1, Math.min(maxSize, Number.parseInt(String(query.pageSize ?? '25'), 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/** Reads a JSON object body field as a trimmed string (or null). */
export function str(body: unknown, key: string, max = 500): string | null {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

export const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;
