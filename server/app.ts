import { randomUUID } from 'node:crypto';
import { basename, extname, sep } from 'node:path';
import { parse as parseQuery } from 'node:querystring';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  referenceFromId,
  type CurrentCohortResponse,
  type SubmitApplicationResponse,
} from '../src/shared/application';
import { MESSAGES, isHoneypotFilled, validateApplication } from '../src/shared/validation';
import { accountRoutes } from './account/routes';
import { accountAdminRoutes, cohortRoutes } from './admin/accounts';
import { applicantRoutes } from './admin/applicants';
import { communicationRoutes } from './admin/communications';
import { directoryRoutes } from './admin/directory';
import { parishReviewRoutes } from './admin/parish-review';
import { platformRoutes } from './admin/platform';
import { reportRoutes } from './admin/reports';
import { recordEvent } from './analytics';
import { staffGuard } from './auth/guards';
import { staffMfaRoutes } from './auth/staff-mfa-routes';
import { staffAuthRoutes } from './auth/staff-routes';
import { hasStaticBuild, type AppConfig } from './config';
import { Secrets } from './crypto';
import type { Db } from './db';
import { cameViaEdgeProxy, edgeProxyCheck } from './edge-proxy';
import { createDirectoryApi } from './directory/api';
import { createEmailTransport, type EmailTransport } from './email';
import { sendError } from './http';
import { parishDirectoryEnabled, parishRoutes, resolveParish } from './parishes';
import { publicRoutes } from './public';
import { pushRoutes } from './push/routes';
import { PushService } from './push/service';
import { HttpsPushTransport, type PushTransport } from './push/transport';
import { getCurrentCohort, insertApplication } from './repository';
import { directoryNamespace, type Services } from './services';
import { backgroundIdle } from './background';

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

/** Creates the shared services. Tests pass a fake email transport and push transport. */
export function createServices(
  config: AppConfig,
  db: Db,
  overrides: { email?: EmailTransport; pushTransport?: PushTransport; directoryFetch?: typeof fetch; directorySleep?: (ms: number) => Promise<void> } = {},
): Services {
  const push = config.push.publicKey
    ? new PushService(config.push, overrides.pushTransport ?? new HttpsPushTransport(config.push.extraHosts))
    : null;
  const directory = config.directoryApi
    ? createDirectoryApi({ env: config.directoryApi.env, key: config.directoryApi.key, fetch: overrides.directoryFetch, sleep: overrides.directorySleep })
    : null;
  return { config, db, secrets: new Secrets(config.appSecret), email: overrides.email ?? createEmailTransport(config), push, directory };
}

/** Also the rules vercel.json gives the same files (server/vercel-config.test.ts). */
export function cacheControlFor(filePath: string): string {
  const name = basename(filePath);
  // The service worker, manifest, offline page and build id must be re-checked every time,
  // so updates (and emergency rollbacks) reach everyone quickly.
  if (['index.html', 'sw.js', 'manifest.webmanifest', 'offline.html', 'build-id.txt'].includes(name)) return 'no-cache';
  if (filePath.includes(`${sep}assets${sep}`)) return 'public, max-age=31536000, immutable'; // content-hashed by Vite
  if (filePath.includes(`${sep}icons${sep}`)) return 'public, max-age=604800';
  return 'public, max-age=3600';
}

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()';

// One value per query field, the first, as URLSearchParams.get() reads it: a repeated key
// (?q=a&q=b) would otherwise arrive as an array, which no route expects.
export function firstValues(text: string): Record<string, string> {
  const parsed = parseQuery(text);
  const query: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(parsed)) query[key] = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  return query;
}

// Database errors carry the values involved: a duplicate email, the failing row, the query's
// parameters (PGlite). Logs keep what identifies the fault (code, constraint, message, stack).
const ERROR_DATA_FIELDS = new Set(['detail', 'where', 'internalQuery', 'query', 'params', 'parameters', 'queryOptions']);

type LoggedError = { type: string; message: string; stack: string; [key: string]: unknown };

export function errorForLog(error: Error): LoggedError {
  const fields: LoggedError = { type: error.constructor.name, message: error.message, stack: error.stack ?? '' };
  for (const [key, value] of Object.entries(error)) if (!ERROR_DATA_FIELDS.has(key)) fields[key] = value;
  if (error.cause !== undefined) fields.cause = error.cause instanceof Error ? errorForLog(error.cause) : error.cause;
  return fields;
}

export async function buildApp({
  config,
  db,
  services: provided,
  logStream,
}: {
  config: AppConfig;
  db: Db;
  services?: Services;
  /** Where log lines go (default stdout). Tests capture them to check nothing sensitive is logged. */
  logStream?: { write(line: string): void };
}): Promise<FastifyInstance> {
  const services = provided ?? createServices(config, db);
  const checkEdgeProxy = edgeProxyCheck(config.edgeProxySecret);
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
      serializers: {
        // Fastify's own request fields, but the path without its query string: searches carry what
        // people typed (a parish name, an applicant's name in the admin area) and their state.
        req: (request: FastifyRequest) => ({
          method: request.method,
          url: (request.url ?? '').split('?')[0],
          host: request.host,
          remoteAddress: request.ip,
          remotePort: request.socket?.remotePort,
        }),
        err: errorForLog,
      },
      ...(logStream ? { stream: logStream } : {}),
    },
    trustProxy: config.trustProxy,
    routerOptions: { querystringParser: firstValues },
    // Runs before Fastify logs a request or works out its address (server/edge-proxy.ts).
    rewriteUrl(req) {
      checkEdgeProxy(req, this.log);
      return req.url ?? '/';
    },
    bodyLimit: 16 * 1024,
    genReqId: () => randomUUID(),
    // Log API requests only (never their bodies: they contain personal data). Static files would
    // drown the log, and the Docker health check hits /api/health every 30 s.
    logController: new LogController({
      disableRequestLogging: (request) => !request.url.startsWith('/api/') || request.url === '/api/health',
    }),
  });
  app.decorate('services', services);
  app.decorateRequest('staff', undefined);
  app.decorateRequest('account', undefined);

  for (const warning of config.warnings) app.log.warn(warning);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'"],
      },
    },
    // No includeSubDomains: other subdomains of the organisation's domain may not be on HTTPS.
    strictTransportSecurity: { maxAge: 15_552_000, includeSubDomains: false },
    frameguard: { action: 'deny' }, // matches frame-ancestors 'none' for older browsers
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  // Browser features the site never uses, off for it and for anything it could embed (helmet doesn't
  // set this header). The clipboard stays available: "copy reference" uses it.
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('permissions-policy', PERMISSIONS_POLICY);
  });

  // Only API routes are limited: a church hall full of people on one Wi-Fi network
  // shares a single IP address, so page loads must never be throttled.
  await app.register(rateLimit, { global: false });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) {
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
      // Lets an out-of-date app notice a new release and offer to update. When Vercel serves the
      // website, the page belongs to Vercel's release, which the edge proxy adds instead.
      if (!cameViaEdgeProxy(request)) reply.header('x-app-build', config.buildId);
    }
    return payload;
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status === 429) {
      return sendError(reply, 429, 'RATE_LIMITED', 'Too many attempts from your network. Please wait a few minutes and try again.');
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return sendError(reply, 413, 'PAYLOAD_TOO_LARGE', 'That request is too large.');
    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return sendError(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request as JSON.');
    }
    if (status >= 400 && status < 500) return sendError(reply, 400, 'BAD_REQUEST', 'The request could not be read.');
    // A Postgres "data exception" (class 22: a value it can't store or convert) comes from what the
    // request sent. Its message can quote that value, so only the code is logged.
    if (typeof error.code === 'string' && /^22[0-9A-Z]{3}$/.test(error.code)) {
      request.log.warn({ code: error.code }, 'The database refused a value from the request');
      return sendError(reply, 400, 'BAD_REQUEST', 'Some of that information could not be saved. Check it and try again.');
    }
    request.log.error({ err: error }, 'Unhandled error');
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again in a moment.');
  });

  // ── Public API ────────────────────────────────────────────────────────────

  app.get('/api/health', async (request, reply) => {
    try {
      await db.query('select 1');
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      request.log.error({ err: error }, 'Health check: database unreachable');
      return reply.code(503).send({ status: 'error', database: 'unreachable' });
    }
  });

  app.get(
    '/api/cohorts/current',
    { config: { rateLimit: { max: 120, timeWindow: 60_000 } } },
    async (): Promise<CurrentCohortResponse> => {
      const cohort = await getCurrentCohort(db);
      return {
        cohort: cohort && {
          slug: cohort.slug,
          name: cohort.name,
          edition: cohort.edition,
          isAcceptingApplications: cohort.is_open,
          applicationsCloseAt: cohort.applications_close_at ? new Date(cohort.applications_close_at).toISOString() : null,
        },
      };
    },
  );

  app.post(
    '/api/applications',
    { config: { rateLimit: { max: config.rateLimit.submitMax, timeWindow: config.rateLimit.submitWindowMs } } },
    async (request, reply) => {
      if (isHoneypotFilled(request.body)) {
        // Look successful so the bot moves on, but store nothing.
        request.log.warn('Honeypot field filled in; submission discarded');
        const id = randomUUID();
        return reply.code(201).send({ id, reference: referenceFromId(id), submittedAt: new Date().toISOString() });
      }

      // The parish question is compulsory: a parish from the list while the directory is on, else its name.
      const result = validateApplication(request.body, { directory: await parishDirectoryEnabled(db, directoryNamespace(services)) });
      if (!result.ok) {
        return sendError(reply, 400, 'VALIDATION_FAILED', 'Some answers need attention.', {
          fieldErrors: result.fieldErrors,
        });
      }

      const cohort = await getCurrentCohort(db);
      if (!cohort?.is_open) return sendError(reply, 403, 'APPLICATIONS_CLOSED', 'Applications are currently closed.');

      // A listed parish must still be on the list (the draft may be days old), and current.
      const parish = await resolveParish(services, result.value.parish);
      if (!parish.ok) {
        if ('unavailable' in parish) {
          // Never stored unverified: the draft stays in the browser for another try.
          return sendError(reply, 503, 'DIRECTORY_UNAVAILABLE', 'We couldn’t confirm your parish with the RCCG directory just now. Your answers are saved: try again in a few minutes.');
        }
        return sendError(reply, 400, 'VALIDATION_FAILED', 'Some answers need attention.', { fieldErrors: { parishName: parish.error } });
      }

      let row: Awaited<ReturnType<typeof insertApplication>>;
      try {
        row = await insertApplication(db, cohort.id, result.value, parish.link);
      } catch (error) {
        if ((error as { code?: string }).code === '23503') {
          // Unknown consent version: the form is out of date.
          return sendError(reply, 400, 'VALIDATION_FAILED', 'Please reload the page and confirm the consent statement again.', {
            fieldErrors: { consentVersion: MESSAGES.consentRequired },
          });
        }
        throw error;
      }
      if (!row) {
        return sendError(
          reply,
          409,
          'ALREADY_APPLIED',
          'An application with this email address has already been received for this cohort.',
        );
      }

      request.log.info({ applicationId: row.id, cohort: cohort.slug }, 'Application received');
      await recordEvent(db, 'application_submitted');
      return reply.code(201).send({
        id: row.id,
        reference: referenceFromId(row.id),
        submittedAt: new Date(row.created_at).toISOString(),
      } satisfies SubmitApplicationResponse);
    },
  );

  await app.register((instance) => publicRoutes(instance, services), { prefix: '/api' });
  await app.register((instance) => parishRoutes(instance, services), { prefix: '/api/parishes' });
  await app.register((instance) => pushRoutes(instance, services), { prefix: '/api/push' });
  await app.register((instance) => accountRoutes(instance, services), { prefix: '/api/account' });

  // ── Admin API (every route checks a staff session, CSRF for changes, MFA and permission) ──

  await app.register((instance) => staffAuthRoutes(instance, services), { prefix: '/api/admin' });
  await app.register((instance) => staffMfaRoutes(instance, services), { prefix: '/api/admin' });
  await app.register((instance) => applicantRoutes(instance, services), { prefix: '/api/admin/applicants' });
  await app.register((instance) => accountAdminRoutes(instance, services), { prefix: '/api/admin/accounts' });
  await app.register((instance) => cohortRoutes(instance, services), { prefix: '/api/admin/cohorts' });
  await app.register((instance) => communicationRoutes(instance, services), { prefix: '/api/admin' });
  await app.register((instance) => platformRoutes(instance, services), { prefix: '/api/admin' });
  await app.register((instance) => directoryRoutes(instance, services), { prefix: '/api/admin/directory' });
  await app.register((instance) => parishReviewRoutes(instance, services), { prefix: '/api/admin/parish-review' });
  await app.register((instance) => reportRoutes(instance, services), { prefix: '/api/admin/reports' });

  // The old Basic-auth CSV URL: now only for signed-in staff with export permission, via the audited export.
  app.get(
    '/api/admin/applications.csv',
    { preHandler: staffGuard(services, { permission: 'applications.export' }) },
    async (_request, reply) => reply.redirect('/api/admin/applicants/export.csv', 303),
  );

  // ── Website ───────────────────────────────────────────────────────────────

  const serveSpa = hasStaticBuild(config);
  if (serveSpa) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      cacheControl: false,
      // Never a dotfile (a .DS_Store or .env that strayed into the build): the site has none to serve.
      dotfiles: 'ignore',
      // @fastify/static ≥10 passes the Fastify reply here (not the raw Node response).
      setHeaders: (reply: FastifyReply, filePath: string) => {
        reply.header('cache-control', cacheControlFor(filePath));
        if (filePath.endsWith(`${sep}sw.js`)) reply.header('service-worker-allowed', '/');
      },
    });
  } else {
    app.log.warn(`No built website in ${config.staticDir}; serving the API only (run "pnpm build").`);
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    const isPage =
      serveSpa &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !path.startsWith('/api/') &&
      extname(path) === '';
    // Deep links like /apply/review are client-side routes: hand them the app shell.
    if (isPage) {
      if (/^\/(admin|account)(\/|$)/.test(path)) reply.header('x-robots-tag', 'noindex, nofollow');
      return reply.sendFile('index.html');
    }
    return sendError(reply, 404, 'NOT_FOUND', 'Not found.');
  });

  // Work started by a request and not awaited (server/background.ts) finishes before the app closes.
  app.addHook('onClose', async () => backgroundIdle());

  return app;
}
