/**
 * Optional applicant accounts (/api/account). Guest applications keep working: an account only
 * adds status updates, an inbox and notification settings.
 *
 * Sign-in is passwordless: a single-use link, valid 15 minutes, sent to the address; the
 * account is created (as verified) only when the link is used. An application can be claimed
 * only by the account whose verified email matches the application's email, and only when the
 * applicant confirms it. Applicants see published statuses and messages only: never the
 * internal status, notes or reviewer.
 */
import type { FastifyInstance } from 'fastify';
import { referenceFromId } from '../../src/shared/application';
import {
  PUBLISHED_STATUS_LABELS,
  type ApplicantApplication,
  type ApplicationStatus,
  type ClaimableApplication,
  type DeviceSummary,
  type InboxItem,
  type SessionSummary,
} from '../../src/shared/platform';
import { isValidEmail, normalizeEmail } from '../../src/shared/validation';
import { audit } from '../audit';
import { accountGuard, checkOrigin } from '../auth/guards';
import {
  clearSessionCookie,
  createApplicantSession,
  csrfTokenFor,
  revokeApplicantSessions,
  setSessionCookie,
} from '../auth/sessions';
import { consumeAuthToken, createAuthToken, recentTokenCount, voidSignInTokens } from '../auth/tokens';
import { signInEmail } from '../email';
import { deleteApplicantAccount } from './delete';
import { deviceLabel, iso, isUuid, sendError, str } from '../http';
import { deactivateSubscription, findOwned, recordConsent, unlinkSubscription } from '../push/subscriptions';
import type { Services } from '../services';
import { getSettings } from '../settings';

const LINK_MINUTES = 15;
const GENERIC_SENT = 'If that address can receive email, a sign-in link is on its way. It works once and expires in 15 minutes.';

export async function accountsEnabled(services: Services): Promise<boolean> {
  return services.email.canSend && (await getSettings(services.db)).applicant_accounts_enabled;
}

export async function accountRoutes(app: FastifyInstance, services: Services) {
  const { config, db, secrets } = services;
  const signedIn = accountGuard(services);
  const actor = (id: string) => ({ type: 'applicant' as const, id });

  // ── Sign-in ──────────────────────────────────────────────────────────────

  app.post('/sign-in', { config: { rateLimit: { max: 5, timeWindow: 10 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    if (!(await accountsEnabled(services))) {
      return sendError(reply, 503, 'ACCOUNTS_UNAVAILABLE', 'Account sign-in isn’t available yet. You can still apply and keep your reference number.');
    }
    const email = normalizeEmail(str(request.body, 'email', 254) ?? '');
    if (!isValidEmail(email)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Enter a valid email address, like name@example.com');
    const { rows } = await db.query<{ status: string }>('select status::text as status from applicant_accounts where email = $1', [email]);
    // Same answer whatever happens, so nobody can learn which addresses have accounts.
    if (rows[0]?.status !== 'suspended' && (await recentTokenCount(db, 'applicant_sign_in', email, 15)) < 3) {
      const token = await createAuthToken(db, 'applicant_sign_in', email, LINK_MINUTES);
      const origin = config.siteOrigin ?? `${request.protocol}://${request.headers.host}`;
      try {
        await services.email.send(signInEmail(email, `${origin}/account/verify?token=${token}`, LINK_MINUTES));
      } catch (error) {
        // The provider's message can repeat the address: log only its codes.
        const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
        request.log.error({ code, responseCode }, 'Sign-in email could not be sent');
        return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'We couldn’t send the email just now. Please try again in a few minutes.');
      }
    }
    return reply.code(202).send({ message: GENERIC_SENT });
  });

  /** The link lands on a page with a button that POSTs here (so email scanners that open links don't use it up). */
  app.post('/verify', { config: { rateLimit: { max: 10, timeWindow: 10 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    if (!(await getSettings(db)).applicant_accounts_enabled) {
      return sendError(reply, 503, 'ACCOUNTS_UNAVAILABLE', 'Account sign-in isn’t available at the moment. Your application is safe.');
    }
    const token = await consumeAuthToken(db, 'applicant_sign_in', str(request.body, 'token', 80) ?? '');
    if (!token) return sendError(reply, 400, 'INVALID_TOKEN', 'This sign-in link has expired or has already been used. Ask for a new one.');
    await voidSignInTokens(db, token.email); // any other link sent to this address stops working
    const { rows } = await db.query<{ id: string; status: string; created: boolean }>(
      `insert into applicant_accounts (email, email_verified_at, last_login_at) values ($1, now(), now())
       on conflict (email) do update set last_login_at = now()
       returning id, status::text as status, (xmax = 0) as created`,
      [token.email],
    );
    const account = rows[0]!;
    if (account.status !== 'active') {
      return sendError(reply, 403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact the Programme team if you think this is a mistake.');
    }
    const session = await createApplicantSession(db, account.id, config.auth.applicantSessionDays, deviceLabel(request.headers['user-agent']));
    setSessionCookie(reply, 'applicant', session.token, config, config.auth.applicantSessionDays * 86_400);
    await audit(db, actor(account.id), account.created ? 'account.created' : 'account.sign_in', { type: 'account', id: account.id });
    return { account: { email: token.email }, csrfToken: csrfTokenFor(secrets, 'applicant', session.id) };
  });

  app.get('/me', { preHandler: signedIn }, async (request) => ({
    account: { email: request.account!.email, createdAt: iso(request.account!.createdAt) },
    csrfToken: csrfTokenFor(secrets, 'applicant', request.account!.sessionId),
  }));

  app.post('/logout', { preHandler: signedIn }, async (request, reply) => {
    await db.query('update applicant_sessions set revoked_at = now() where id = $1', [request.account!.sessionId]);
    clearSessionCookie(reply, 'applicant', config);
    return { ok: true };
  });

  // ── Applications ─────────────────────────────────────────────────────────

  app.get('/applications', { preHandler: signedIn }, async (request): Promise<{ claimed: ApplicantApplication[]; claimable: ClaimableApplication[] }> => {
    const account = request.account!;
    const { rows } = await db.query<{
      id: string;
      account_id: string | null;
      cohort_name: string;
      created_at: Date;
      published_status: ApplicationStatus;
      published_message: string | null;
      published_at: Date | null;
    }>(
      `select a.id, a.account_id, c.name as cohort_name, a.created_at, a.published_status::text as published_status,
              a.published_message, a.published_at
         from applications a join cohorts c on c.id = a.cohort_id
        where a.account_id = $1 or (a.account_id is null and a.email = $2)
        order by a.created_at desc`,
      [account.id, account.email],
    );
    return {
      claimed: rows
        .filter((row) => row.account_id === account.id)
        .map((row) => ({
          id: row.id,
          reference: referenceFromId(row.id),
          cohortName: row.cohort_name,
          submittedAt: iso(row.created_at)!,
          status: row.published_status,
          statusLabel: PUBLISHED_STATUS_LABELS[row.published_status].label,
          statusDescription: PUBLISHED_STATUS_LABELS[row.published_status].description,
          message: row.published_message,
          publishedAt: iso(row.published_at),
        })),
      claimable: rows
        .filter((row) => row.account_id === null)
        .map((row) => ({ id: row.id, reference: referenceFromId(row.id), cohortName: row.cohort_name, submittedAt: iso(row.created_at)! })),
    };
  });

  app.post<{ Params: { id: string } }>('/applications/:id/claim', { preHandler: signedIn }, async (request, reply) => {
    const account = request.account!;
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    // Ownership is the verified email address of this account; nothing else links an application.
    const { rows } = await db.query<{ id: string }>(
      `update applications set account_id = $1, claimed_at = now()
        where id = $2 and email = $3 and account_id is null returning id`,
      [account.id, request.params.id, account.email],
    );
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'That application isn’t available to link to this account.');
    await audit(db, actor(account.id), 'application.claimed', { type: 'application', id: rows[0].id });
    return { ok: true };
  });

  // ── Inbox and notices ────────────────────────────────────────────────────

  app.get('/inbox', { preHandler: signedIn }, async (request): Promise<{ items: InboxItem[]; unread: number }> => {
    const account = request.account!;
    const { rows } = await db.query<{
      id: string;
      kind: 'application_update' | 'message' | 'notice';
      title: string;
      body: string;
      link_path: string | null;
      created_at: Date;
      read: boolean;
    }>(
      `(select id, kind, title, body, link_path, created_at, read_at is not null as read
          from inbox_items where account_id = $1)
       union all
       (select n.id, 'notice', n.title, n.body, null, n.published_at, true
          from announcements n
         where n.status = 'published' and n.audience = 'applicants'
           and (n.cohort_id is null or exists (select 1 from applications ap where ap.account_id = $1 and ap.cohort_id = n.cohort_id)))
       order by created_at desc limit 100`,
      [account.id],
    );
    return {
      items: rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title, body: row.body, linkPath: row.link_path, createdAt: iso(row.created_at)!, read: row.read })),
      unread: rows.filter((row) => !row.read).length,
    };
  });

  app.post<{ Params: { id: string } }>('/inbox/:id/read', { preHandler: signedIn }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found.');
    await db.query('update inbox_items set read_at = coalesce(read_at, now()) where id = $1 and account_id = $2', [
      request.params.id,
      request.account!.id,
    ]);
    return { ok: true };
  });

  // ── Devices (push subscriptions) ─────────────────────────────────────────

  /** This browser marks itself as "current" by comparing ids with /api/push/status. */
  app.get('/devices', { preHandler: signedIn }, async (request): Promise<{ devices: DeviceSummary[] }> => {
    const { rows } = await db.query<{
      id: string;
      device_label: string | null;
      topics: DeviceSummary['topics'];
      status: DeviceSummary['status'];
      created_at: Date;
      last_seen_at: Date;
    }>(
      `select id, device_label, topics, status::text as status, created_at, last_seen_at
         from push_subscriptions where account_id = $1 and status = 'active' order by last_seen_at desc`,
      [request.account!.id],
    );
    return {
      devices: rows.map((row) => ({
        id: row.id,
        label: row.device_label ?? 'Unknown device',
        topics: row.topics,
        status: row.status,
        createdAt: iso(row.created_at)!,
        lastSeenAt: iso(row.last_seen_at)!,
        current: false,
      })),
    };
  });

  /** Links this browser's subscription to the account (possession of the auth secret + signed in). */
  app.post('/devices/link', { preHandler: signedIn }, async (request, reply) => {
    const body = request.body as { endpoint?: unknown; auth?: unknown } | null;
    const row = await findOwned(db, body?.endpoint, body?.auth);
    if (!row || row.status !== 'active' || row.staff_id) return sendError(reply, 404, 'NOT_FOUND', 'Turn on notifications on this device first.');
    await db.query('update push_subscriptions set account_id = $2, updated_at = now() where id = $1', [row.id, request.account!.id]);
    await recordConsent(db, row.id, request.account!.id, 'linked', row.topics);
    await audit(db, actor(request.account!.id), 'device.linked', { type: 'push_subscription', id: row.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/devices/:id/remove', { preHandler: signedIn }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Device not found.');
    const { rows } = await db.query<{ id: string }>(
      `select id from push_subscriptions where id = $1 and account_id = $2 and status = 'active'`,
      [request.params.id, request.account!.id],
    );
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Device not found.');
    await deactivateSubscription(db, rows[0].id, 'unsubscribed');
    await unlinkSubscription(db, rows[0].id);
    await audit(db, actor(request.account!.id), 'device.removed', { type: 'push_subscription', id: rows[0].id });
    return { ok: true };
  });

  // ── Sessions and the account itself ──────────────────────────────────────

  app.get('/sessions', { preHandler: signedIn }, async (request): Promise<{ sessions: SessionSummary[] }> => {
    const { rows } = await db.query<{ id: string; device_label: string | null; created_at: Date; last_seen_at: Date }>(
      `select id, device_label, created_at, last_seen_at from applicant_sessions
        where account_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
      [request.account!.id],
    );
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        deviceLabel: row.device_label ?? 'Unknown device',
        createdAt: iso(row.created_at)!,
        lastSeenAt: iso(row.last_seen_at)!,
        current: row.id === request.account!.sessionId,
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/revoke', { preHandler: signedIn }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Session not found.');
    const { rows } = await db.query(
      'update applicant_sessions set revoked_at = now() where id = $1 and account_id = $2 and revoked_at is null returning id',
      [request.params.id, request.account!.id],
    );
    if (!rows.length) return sendError(reply, 404, 'NOT_FOUND', 'Session not found.');
    if (request.params.id === request.account!.sessionId) clearSessionCookie(reply, 'applicant', config);
    return { ok: true };
  });

  app.post('/sessions/revoke-others', { preHandler: signedIn }, async (request) => {
    await revokeApplicantSessions(db, request.account!.id, request.account!.sessionId);
    await audit(db, actor(request.account!.id), 'account.sessions_revoked', { type: 'account', id: request.account!.id });
    return { ok: true };
  });

  /** Deletes the account. Applications stay with the Programme team as submitted, unlinked. */
  app.post('/delete', { preHandler: signedIn }, async (request, reply) => {
    const account = request.account!;
    if (str(request.body, 'confirm', 254)?.toLowerCase() !== account.email) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Type your email address to confirm.');
    }
    await deleteApplicantAccount(db, account.id);
    clearSessionCookie(reply, 'applicant', config);
    await audit(db, actor(account.id), 'account.deleted', { type: 'account', id: account.id });
    return { ok: true };
  });
}
