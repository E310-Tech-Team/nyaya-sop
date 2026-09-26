/** Applicant accounts (/api/admin/accounts) and cohorts (/api/admin/cohorts). */
import type { FastifyInstance } from 'fastify';
import { referenceFromId } from '../../src/shared/application';
import { DEFAULT_TIME_ZONE, isValidTimeZone, zonedLocalToUtc } from '../../src/shared/time';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import { revokeApplicantSessions } from '../auth/sessions';
import { staffActor } from '../auth/staff-routes';
import { iso, isUuid, paging, sendError, str } from '../http';
import { deleteApplicantAccount } from '../account/delete';
import { deactivateSubscription } from '../push/subscriptions';
import type { Services } from '../services';

export async function accountAdminRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const view = staffGuard(services, { permission: 'accounts.view' });
  const manage = staffGuard(services, { permission: 'accounts.manage' });

  app.get<{ Querystring: { q?: string; status?: string; page?: string; pageSize?: string } }>('/', { preHandler: view }, async (request) => {
    const { page, pageSize, offset } = paging(request.query);
    const q = request.query.q?.trim().toLowerCase().slice(0, 100);
    const status = request.query.status === 'active' || request.query.status === 'suspended' ? request.query.status : null;
    const { rows } = await db.query<{
      id: string;
      email: string;
      status: string;
      created_at: Date;
      last_login_at: Date | null;
      applications: number;
      devices: number;
      total: number;
    }>(
      `select a.id, a.email, a.status::text as status, a.created_at, a.last_login_at,
              (select count(*)::int from applications ap where ap.account_id = a.id) as applications,
              (select count(*)::int from push_subscriptions s where s.account_id = a.id and s.status = 'active') as devices,
              count(*) over ()::int as total
         from applicant_accounts a
        where ($1::text is null or a.email like '%' || $1 || '%') and ($2::text is null or a.status::text = $2)
        order by a.created_at desc limit ${pageSize} offset ${offset}`,
      [q ? q.replace(/[\\%_]/g, (c) => `\\${c}`) : null, status],
    );
    return {
      page,
      pageSize,
      total: rows[0]?.total ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        status: row.status,
        createdAt: iso(row.created_at),
        lastLoginAt: iso(row.last_login_at),
        applications: row.applications,
        devices: row.devices,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: view }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Account not found.');
    const { rows } = await db.query<{ id: string; email: string; status: string; created_at: Date; last_login_at: Date | null; suspended_at: Date | null }>(
      'select id, email, status::text as status, created_at, last_login_at, suspended_at from applicant_accounts where id = $1',
      [request.params.id],
    );
    const account = rows[0];
    if (!account) return sendError(reply, 404, 'NOT_FOUND', 'Account not found.');
    const applications = await db.query<{ id: string; cohort: string; published_status: string; claimed_at: Date }>(
      `select a.id, c.name as cohort, a.published_status::text as published_status, a.claimed_at
         from applications a join cohorts c on c.id = a.cohort_id where a.account_id = $1 order by a.created_at desc`,
      [account.id],
    );
    const devices = await db.query<{ id: string; device_label: string | null; topics: string[]; status: string; created_at: Date; last_seen_at: Date }>(
      `select id, device_label, topics, status::text as status, created_at, last_seen_at from push_subscriptions
        where account_id = $1 order by last_seen_at desc limit 50`,
      [account.id],
    );
    const sessions = await db.query<{ n: number }>(
      'select count(*)::int as n from applicant_sessions where account_id = $1 and revoked_at is null and expires_at > now()',
      [account.id],
    );
    await audit(db, staffActor(request.staff!), 'account.viewed', { type: 'account', id: account.id });
    return {
      id: account.id,
      email: account.email,
      status: account.status,
      createdAt: iso(account.created_at),
      lastLoginAt: iso(account.last_login_at),
      suspendedAt: iso(account.suspended_at),
      activeSessions: sessions.rows[0]!.n,
      applications: applications.rows.map((row) => ({ id: row.id, reference: referenceFromId(row.id), cohort: row.cohort, publishedStatus: row.published_status, claimedAt: iso(row.claimed_at) })),
      devices: devices.rows.map((row) => ({ id: row.id, label: row.device_label ?? 'Unknown device', topics: row.topics, status: row.status, createdAt: iso(row.created_at), lastSeenAt: iso(row.last_seen_at) })),
    };
  });

  app.post<{ Params: { id: string } }>('/:id/suspend', { preHandler: manage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Account not found.');
    const { rows } = await db.query<{ id: string }>(
      `update applicant_accounts set status = 'suspended', suspended_at = now() where id = $1 and status = 'active' returning id`,
      [request.params.id],
    );
    if (!rows[0]) return sendError(reply, 409, 'CONFLICT', 'That account is already suspended or doesn’t exist.');
    await revokeApplicantSessions(db, rows[0].id);
    const devices = await db.query<{ id: string }>(`select id from push_subscriptions where account_id = $1 and status = 'active'`, [rows[0].id]);
    for (const device of devices.rows) await deactivateSubscription(db, device.id, 'account_suspended');
    await audit(db, staffActor(request.staff!), 'account.suspended', { type: 'account', id: rows[0].id }, { devices: devices.rows.length });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/reactivate', { preHandler: manage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Account not found.');
    const { rows } = await db.query<{ id: string }>(
      `update applicant_accounts set status = 'active', suspended_at = null where id = $1 and status = 'suspended' returning id`,
      [request.params.id],
    );
    if (!rows[0]) return sendError(reply, 409, 'CONFLICT', 'That account isn’t suspended.');
    await audit(db, staffActor(request.staff!), 'account.reactivated', { type: 'account', id: rows[0].id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/revoke-sessions', { preHandler: manage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Account not found.');
    await revokeApplicantSessions(db, request.params.id);
    await audit(db, staffActor(request.staff!), 'account.sessions_revoked', { type: 'account', id: request.params.id });
    return { ok: true };
  });

  /** Deletes the account (not its applications, which stay unlinked). Needs the email typed back. */
  app.post<{ Params: { id: string } }>('/:id/delete', { preHandler: manage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Account not found.');
    const { rows } = await db.query<{ email: string }>('select email from applicant_accounts where id = $1', [request.params.id]);
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Account not found.');
    if (str(request.body, 'confirm', 254)?.toLowerCase() !== rows[0].email) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Type the account’s email address to confirm.');
    }
    await deleteApplicantAccount(db, request.params.id);
    await audit(db, staffActor(request.staff!), 'account.deleted', { type: 'account', id: request.params.id });
    return { ok: true };
  });
}

// ── Cohorts ──────────────────────────────────────────────────────────────────

type CohortInput = {
  slug?: unknown;
  name?: unknown;
  edition?: unknown;
  opensAt?: unknown;
  closesAt?: unknown;
  timeZone?: unknown;
  acceptingApplications?: unknown;
};

function parseCohort(input: CohortInput, partial: boolean) {
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : DEFAULT_TIME_ZONE;
  if (input.slug !== undefined || !partial) {
    if (typeof input.slug !== 'string' || !/^[a-z0-9-]{3,60}$/.test(input.slug)) errors.slug = 'Use 3–60 lowercase letters, numbers and hyphens.';
    else out.slug = input.slug;
  }
  if (input.name !== undefined || !partial) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 2 || name.length > 120) errors.name = 'Enter a name (2–120 characters).';
    else out.name = name;
  }
  if (input.edition !== undefined || !partial) {
    const edition = Number(input.edition);
    if (!Number.isInteger(edition) || edition < 1 || edition > 999) errors.edition = 'Enter an edition number.';
    else out.edition = edition;
  }
  for (const [key, column] of [['opensAt', 'applications_open_at'], ['closesAt', 'applications_close_at']] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null || value === '') out[column] = null;
    else {
      try {
        out[column] = zonedLocalToUtc(String(value), timeZone);
      } catch {
        errors[key] = 'Enter a date and time.';
      }
    }
  }
  if (input.acceptingApplications !== undefined) out.is_accepting_applications = input.acceptingApplications === true;
  const opens = out.applications_open_at as Date | null | undefined;
  const closes = out.applications_close_at as Date | null | undefined;
  if (opens && closes && closes <= opens) errors.closesAt = 'The closing time must be after the opening time.';
  return { errors, values: out };
}

export async function cohortRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const manage = staffGuard(services, { permission: 'cohorts.manage' });
  const view = staffGuard(services, { permission: ['cohorts.manage', 'applications.view_all', 'campaigns.manage', 'dashboard.view'] });

  app.get('/', { preHandler: view }, async () => {
    const { rows } = await db.query<{
      id: string;
      slug: string;
      name: string;
      edition: number;
      applications_open_at: Date | null;
      applications_close_at: Date | null;
      is_accepting_applications: boolean;
      is_open: boolean;
      created_at: Date;
      totals: Record<string, number> | null;
    }>(
      `select c.id, c.slug, c.name, c.edition, c.applications_open_at, c.applications_close_at, c.is_accepting_applications, c.created_at,
              (c.is_accepting_applications and (c.applications_open_at is null or c.applications_open_at <= now())
                and (c.applications_close_at is null or c.applications_close_at > now())) as is_open,
              (select jsonb_object_agg(status, n) from (select a.status::text as status, count(*)::int as n from applications a
                 where a.cohort_id = c.id group by a.status) t) as totals
         from cohorts c order by c.edition desc, c.created_at desc`,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        edition: row.edition,
        opensAt: iso(row.applications_open_at),
        closesAt: iso(row.applications_close_at),
        acceptingApplications: row.is_accepting_applications,
        isOpenNow: row.is_open,
        createdAt: iso(row.created_at),
        totals: row.totals ?? {},
        total: Object.values(row.totals ?? {}).reduce((sum, n) => sum + n, 0),
      })),
    };
  });

  app.post('/', { preHandler: manage }, async (request, reply) => {
    const { errors, values } = parseCohort((request.body ?? {}) as CohortInput, false);
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors as never });
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into cohorts (slug, name, edition, applications_open_at, applications_close_at, is_accepting_applications)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [values.slug, values.name, values.edition, values.applications_open_at ?? null, values.applications_close_at ?? null, values.is_accepting_applications ?? false],
      );
      await audit(db, staffActor(request.staff!), 'cohort.created', { type: 'cohort', id: rows[0]!.id });
      return reply.code(201).send({ id: rows[0]!.id });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return sendError(reply, 409, 'CONFLICT', 'A cohort with that slug already exists.');
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: manage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Cohort not found.');
    const { errors, values } = parseCohort((request.body ?? {}) as CohortInput, true);
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors as never });
    const columns = Object.keys(values);
    if (!columns.length) return { ok: true };
    try {
      const { rows } = await db.query(
        `update cohorts set ${columns.map((column, index) => `${column} = $${index + 2}`).join(', ')} where id = $1 returning id`,
        [request.params.id, ...columns.map((column) => values[column])],
      );
      if (!rows.length) return sendError(reply, 404, 'NOT_FOUND', 'Cohort not found.');
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') return sendError(reply, 409, 'CONFLICT', 'A cohort with that slug already exists.');
      if (code === '23514') return sendError(reply, 400, 'VALIDATION_FAILED', 'The closing time must be after the opening time.');
      throw error;
    }
    await audit(db, staffActor(request.staff!), 'cohort.updated', { type: 'cohort', id: request.params.id }, { fields: columns });
    return { ok: true };
  });
}
