/** Staff management, settings, integration health, audit history and the dashboard (/api/admin). */
import type { FastifyInstance } from 'fastify';
import { can, isStaffRole } from '../../src/shared/permissions';
import { isValidEmail, normalizeEmail } from '../../src/shared/validation';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import { revokeStaffSessions } from '../auth/sessions';
import { createStaffInvite, inviteLink, staffActor } from '../auth/staff-routes';
import { voidStaffTokens } from '../auth/tokens';
import { staffInviteEmail } from '../email';
import { iso, isUuid, paging, sendError, str } from '../http';
import { queueStats } from '../jobs/queue';
import type { Services } from '../services';
import { getSettings, putSetting, SETTING_DEFAULTS } from '../settings';
import { directoryReadiness } from './directory';

/**
 * "Another active owner remains", checked in the same statement as the change: the CTE locks the
 * active owners' rows, so two owners demoting or suspending each other at once can't both succeed.
 */
const OTHER_OWNERS_LOCKED = `with owners as (select id from staff_users where role = 'owner' and status = 'active' order by id for update)`;
const anotherOwner = (param: string) => `(select count(*) from owners where id <> ${param}) > 0`;

/** Integration status without secret values: configured or not, and non-secret facts. */
export async function integrationHealth(services: Services) {
  const { db, config } = services;
  let database: 'ok' | 'error' = 'ok';
  try {
    await db.query('select 1');
  } catch {
    database = 'error';
  }
  const { rows } = await db.query<{ value: string }>(`select value #>> '{}' as value from app_settings where key = 'heartbeat_worker'`);
  const heartbeat = rows[0]?.value ? new Date(rows[0].value) : null;
  const queue = await queueStats(db);
  return {
    database,
    email: { transport: config.email.transport, canSend: services.email.canSend },
    push: {
      configured: Boolean(services.push),
      // A short fingerprint of the public key (public anyway) so you can tell key pairs apart.
      publicKeyFingerprint: services.push ? services.push.publicKey.slice(0, 8) : null,
    },
    worker: {
      mode: config.worker.mode,
      lastHeartbeat: heartbeat ? heartbeat.toISOString() : null,
      healthy: Boolean(heartbeat && Date.now() - heartbeat.getTime() < 120_000),
    },
    queue: { ...queue, oldestPendingAt: iso(queue.oldestPendingAt) },
    siteOrigin: config.siteOrigin,
    mfaRequired: config.auth.staffMfaRequired,
    buildId: config.buildId,
  };
}

export async function platformRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const manageStaff = staffGuard(services, { permission: 'staff.manage' });

  // ── Staff ────────────────────────────────────────────────────────────────

  app.get('/staff', { preHandler: manageStaff }, async () => {
    const { rows } = await db.query<{
      id: string;
      email: string;
      display_name: string;
      role: string;
      status: string;
      mfa_enabled_at: Date | null;
      last_login_at: Date | null;
      created_at: Date;
      locked_until: Date | null;
    }>(
      `select id, email, display_name, role::text as role, status::text as status, mfa_enabled_at, last_login_at, created_at, locked_until
         from staff_users order by status, display_name`,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        mfaEnabled: Boolean(row.mfa_enabled_at),
        lastLoginAt: iso(row.last_login_at),
        createdAt: iso(row.created_at),
        lockedUntil: row.locked_until && new Date(row.locked_until) > new Date() ? iso(row.locked_until) : null,
      })),
    };
  });

  /** Reviewers who can be assigned applications (programme admins see this list too). */
  app.get('/reviewers', { preHandler: staffGuard(services, { permission: 'applications.assign' }) }, async () => {
    const { rows } = await db.query<{ id: string; display_name: string; role: string }>(
      `select id, display_name, role::text as role from staff_users
        where status = 'active' and role in ('reviewer', 'programme_admin', 'owner') order by display_name`,
    );
    return { items: rows.map((row) => ({ id: row.id, name: row.display_name, role: row.role })) };
  });

  app.post('/staff', { preHandler: manageStaff, config: { rateLimit: { max: 20, timeWindow: 60 * 60_000 } } }, async (request, reply) => {
    const input = (request.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(str(input, 'email', 254) ?? '');
    const displayName = str(input, 'displayName', 80);
    const role = input.role;
    const errors: Record<string, string> = {};
    if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
    if (!displayName) errors.displayName = 'Enter their name.';
    if (!isStaffRole(role)) errors.role = 'Choose a role.';
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors as never });
    const result = await createStaffInvite(services, { email, displayName: displayName!, role: role as never, invitedBy: request.staff!.id });
    if (result === 'exists') return sendError(reply, 409, 'CONFLICT', 'There is already a staff account for that email address.');
    await audit(db, staffActor(request.staff!), 'staff.invited', { type: 'staff', id: result.staffId }, { role, emailed: result.emailed });
    // The link is only shown when it couldn't be emailed; share it privately.
    return reply.code(201).send({ id: result.staffId, emailed: result.emailed, inviteUrl: result.emailed ? null : result.url });
  });

  const target = async (id: string) => {
    if (!isUuid(id)) return null;
    const { rows } = await db.query<{ id: string; role: string; status: string; email: string }>(
      'select id, role::text as role, status::text as status, email from staff_users where id = $1',
      [id],
    );
    return rows[0] ?? null;
  };

  app.post<{ Params: { id: string } }>('/staff/:id/role', { preHandler: manageStaff }, async (request, reply) => {
    const staff = await target(request.params.id);
    if (!staff) return sendError(reply, 404, 'NOT_FOUND', 'Staff member not found.');
    // Nobody changes their own role (no self-elevation), and the last owner stays an owner.
    if (staff.id === request.staff!.id) return sendError(reply, 403, 'FORBIDDEN', 'You can’t change your own role. Ask another owner.');
    const role = (request.body as { role?: unknown } | null)?.role;
    if (!isStaffRole(role)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a role.');
    const { rows: changed } = await db.query(
      `${OTHER_OWNERS_LOCKED}
       update staff_users set role = $2::staff_role where id = $1::uuid and ($2::staff_role = 'owner' or role <> 'owner' or ${anotherOwner('$1::uuid')}) returning id`,
      [staff.id, role],
    );
    if (!changed.length) return sendError(reply, 409, 'CONFLICT', 'There must always be at least one active owner.');
    await revokeStaffSessions(db, staff.id); // new permissions take effect on their next sign-in
    await audit(db, staffActor(request.staff!), 'staff.role_changed', { type: 'staff', id: staff.id }, { from: staff.role, to: role });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/staff/:id/suspend', { preHandler: manageStaff }, async (request, reply) => {
    const staff = await target(request.params.id);
    if (!staff) return sendError(reply, 404, 'NOT_FOUND', 'Staff member not found.');
    if (staff.id === request.staff!.id) return sendError(reply, 403, 'FORBIDDEN', 'You can’t suspend yourself.');
    if (staff.status === 'suspended') return sendError(reply, 409, 'CONFLICT', 'Already suspended.');
    const { rows } = await db.query(
      `${OTHER_OWNERS_LOCKED}
       update staff_users set status = 'suspended', suspended_at = now()
        where id = $1::uuid and status <> 'suspended' and (role <> 'owner' or ${anotherOwner('$1::uuid')}) returning id`,
      [staff.id],
    );
    if (!rows.length) return sendError(reply, 409, 'CONFLICT', 'There must always be at least one active owner.');
    await revokeStaffSessions(db, staff.id);
    // Links already sent (invitation, password reset) stop working too; reactivating doesn't revive them.
    await voidStaffTokens(db, staff.id, ['staff_invite', 'staff_password_reset']);
    await audit(db, staffActor(request.staff!), 'staff.suspended', { type: 'staff', id: staff.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/staff/:id/reactivate', { preHandler: manageStaff }, async (request, reply) => {
    const staff = await target(request.params.id);
    if (!staff) return sendError(reply, 404, 'NOT_FOUND', 'Staff member not found.');
    const { rows } = await db.query(
      `update staff_users set status = case when password_hash is null then 'invited'::staff_status else 'active'::staff_status end,
              suspended_at = null, failed_login_count = 0, locked_until = null
        where id = $1 and status = 'suspended' returning id`,
      [staff.id],
    );
    if (!rows.length) return sendError(reply, 409, 'CONFLICT', 'That account isn’t suspended.');
    await audit(db, staffActor(request.staff!), 'staff.reactivated', { type: 'staff', id: staff.id });
    return { ok: true };
  });

  /** For a lost authenticator: clears MFA so they enrol again at next sign-in. Not for yourself. */
  app.post<{ Params: { id: string } }>('/staff/:id/reset-mfa', { preHandler: manageStaff }, async (request, reply) => {
    const staff = await target(request.params.id);
    if (!staff) return sendError(reply, 404, 'NOT_FOUND', 'Staff member not found.');
    if (staff.id === request.staff!.id) return sendError(reply, 403, 'FORBIDDEN', 'Ask another owner to reset your two-step verification.');
    await db.query(
      `update staff_users set mfa_secret_enc = null, mfa_pending_secret_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1`,
      [staff.id],
    );
    await db.query('delete from staff_recovery_codes where staff_id = $1', [staff.id]);
    await revokeStaffSessions(db, staff.id);
    await voidStaffTokens(db, staff.id, ['staff_password_reset']);
    await audit(db, staffActor(request.staff!), 'staff.mfa_reset', { type: 'staff', id: staff.id });
    return { ok: true };
  });

  /** Lifts a sign-in lock (someone else's failed attempts can lock an account on purpose). */
  app.post<{ Params: { id: string } }>('/staff/:id/unlock', { preHandler: manageStaff }, async (request, reply) => {
    const staff = await target(request.params.id);
    if (!staff) return sendError(reply, 404, 'NOT_FOUND', 'Staff member not found.');
    const { rows } = await db.query(`update staff_users set failed_login_count = 0, locked_until = null where id = $1 and locked_until > now() returning id`, [staff.id]);
    if (!rows.length) return sendError(reply, 409, 'CONFLICT', 'That account isn’t locked.');
    await audit(db, staffActor(request.staff!), 'staff.unlocked', { type: 'staff', id: staff.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/staff/:id/resend-invite', { preHandler: manageStaff }, async (request, reply) => {
    const staff = await target(request.params.id);
    if (!staff || staff.status !== 'invited') return sendError(reply, 404, 'NOT_FOUND', 'No pending invitation for that person.');
    const url = await inviteLink(services, staff.id, staff.email);
    let emailed = false;
    if (services.email.canSend) {
      try {
        await services.email.send(staffInviteEmail(staff.email, url, 72));
        emailed = true;
      } catch {
        emailed = false;
      }
    }
    await audit(db, staffActor(request.staff!), 'staff.invite_resent', { type: 'staff', id: staff.id }, { emailed });
    return { emailed, inviteUrl: emailed ? null : url };
  });

  app.post<{ Params: { id: string } }>('/staff/:id/revoke-sessions', { preHandler: manageStaff }, async (request, reply) => {
    const staff = await target(request.params.id);
    if (!staff) return sendError(reply, 404, 'NOT_FOUND', 'Staff member not found.');
    await revokeStaffSessions(db, staff.id, staff.id === request.staff!.id ? request.staff!.sessionId : undefined);
    await audit(db, staffActor(request.staff!), 'staff.sessions_revoked', { type: 'staff', id: staff.id });
    return { ok: true };
  });

  // ── Settings and health ──────────────────────────────────────────────────

  app.get('/settings', { preHandler: staffGuard(services, { permission: 'settings.manage' }) }, async () => ({
    settings: await getSettings(db, 0),
    health: await integrationHealth(services),
    // Whether the parish question can be switched on: what's loaded, from where, and what waits for review.
    directory: await directoryReadiness(db),
  }));

  app.patch('/settings', { preHandler: staffGuard(services, { permission: 'settings.manage' }) }, async (request, reply) => {
    const input = (request.body ?? {}) as Record<string, unknown>;
    const changed: string[] = [];
    if ('support_email' in input) {
      const value = input.support_email === null || input.support_email === '' ? null : normalizeEmail(String(input.support_email));
      if (value !== null && !isValidEmail(value)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Enter a valid support email address.');
      await putSetting(db, 'support_email', value, request.staff!.id);
      changed.push('support_email');
    }
    for (const key of ['applicant_accounts_enabled', 'public_notifications_enabled', 'parish_directory_enabled'] as const) {
      if (key in input) {
        if (typeof input[key] !== 'boolean') return sendError(reply, 400, 'VALIDATION_FAILED', `${key} must be true or false.`);
        if (key === 'parish_directory_enabled' && input[key] === true) {
          const { rows } = await db.query<{ ready: boolean }>(`select exists (select 1 from parishes where status = 'active') as ready`);
          if (!rows[0]!.ready) {
            return sendError(reply, 400, 'VALIDATION_FAILED', 'Import the RCCG parish list before switching the parish directory on (docs/DEPLOYMENT.md, "Parish directory").');
          }
        }
        await putSetting(db, key, input[key] as boolean, request.staff!.id);
        changed.push(key);
      }
    }
    if (changed.length) await audit(db, staffActor(request.staff!), 'settings.changed', null, { keys: changed });
    return { ok: true, settings: await getSettings(db, 0), defaults: SETTING_DEFAULTS };
  });

  // ── Audit history ────────────────────────────────────────────────────────

  app.get<{ Querystring: { action?: string; actor?: string; targetType?: string; targetId?: string; page?: string; pageSize?: string } }>(
    '/audit',
    { preHandler: staffGuard(services, { permission: 'audit.view' }) },
    async (request) => {
      const { page, pageSize, offset } = paging(request.query, 200);
      const { action, actor, targetType, targetId } = request.query;
      const { rows } = await db.query<{
        id: string;
        created_at: Date;
        actor_type: string;
        actor_id: string | null;
        actor_name: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        details: Record<string, unknown>;
        total: number;
      }>(
        `select e.id::text as id, e.created_at, e.actor_type, e.actor_id, s.display_name as actor_name, e.action,
                e.target_type, e.target_id, e.details, count(*) over ()::int as total
           from audit_events e left join staff_users s on e.actor_type = 'staff' and s.id = e.actor_id
          where ($1::text is null or e.action like $1 || '%') and ($2::uuid is null or e.actor_id = $2::uuid)
            and ($3::text is null or e.target_type = $3) and ($4::text is null or e.target_id = $4)
          order by e.created_at desc, e.id desc limit ${pageSize} offset ${offset}`,
        [action && /^[a-z_.]{1,60}$/.test(action) ? action : null, isUuid(actor) ? actor : null, targetType?.slice(0, 40) || null, targetId?.slice(0, 80) || null],
      );
      return {
        page,
        pageSize,
        total: rows[0]?.total ?? 0,
        items: rows.map((row) => ({
          id: row.id,
          at: iso(row.created_at),
          actor: row.actor_type === 'staff' ? (row.actor_name ?? 'Former staff member') : row.actor_type === 'applicant' ? 'Applicant' : 'System',
          actorType: row.actor_type,
          action: row.action,
          target: row.target_type ? { type: row.target_type, id: row.target_id } : null,
          details: row.details,
        })),
      };
    },
  );

  // ── Dashboard ────────────────────────────────────────────────────────────

  app.get('/dashboard', { preHandler: staffGuard(services, { permission: 'dashboard.view' }) }, async (request) => {
    const byCohort = await db.query<{ cohort: string; status: string; n: number }>(
      `select c.name as cohort, a.status::text as status, count(*)::int as n
         from applications a join cohorts c on c.id = a.cohort_id group by c.name, c.edition, a.status order by c.edition desc`,
    );
    const accounts = await db.query<{ status: string; n: number }>(`select status::text as status, count(*)::int as n from applicant_accounts group by status`);
    const subs = await db.query<{ topic: string; linked: number; anonymous: number }>(
      `select t.topic, count(*) filter (where s.account_id is not null)::int as linked, count(*) filter (where s.account_id is null)::int as anonymous
         from push_subscriptions s cross join lateral unnest(s.topics) as t(topic)
        where s.status = 'active' and s.staff_id is null group by t.topic`,
    );
    const devices = await db.query<{ total: number; linked: number }>(
      `select count(*)::int as total, count(account_id)::int as linked from push_subscriptions where status = 'active' and staff_id is null`,
    );
    const campaigns = await db.query<{ status: string; n: number }>(
      `select status::text as status, count(*)::int as n from campaigns where created_at > now() - interval '30 days' group by status`,
    );
    const deliveries = await db.query<{ status: string; n: number }>(
      `select d.status::text as status, count(*)::int as n from notification_deliveries d join notification_messages m on m.id = d.message_id
        where d.created_at > now() - interval '30 days' and m.origin <> 'test' group by d.status`,
    );
    const events = await db.query<{ name: string; n: number }>(
      `select name, count(*)::int as n from analytics_events where created_at > now() - interval '30 days' group by name`,
    );
    const failedJobs = await db.query<{ kind: string; last_error: string | null; updated_at: Date }>(
      `select kind, last_error, updated_at from jobs where status = 'failed' and updated_at > now() - interval '7 days' order by updated_at desc limit 5`,
    );
    const errorDetail = can(request.staff!.role, 'settings.manage') || can(request.staff!.role, 'audit.view');
    const recent = can(request.staff!.role, 'audit.view')
      ? await db.query<{ created_at: Date; action: string; actor_name: string | null; actor_type: string }>(
          `select e.created_at, e.action, e.actor_type, s.display_name as actor_name from audit_events e
             left join staff_users s on e.actor_type = 'staff' and s.id = e.actor_id
            where e.actor_type = 'staff' and e.action not like '%.viewed' order by e.created_at desc limit 10`,
        )
      : { rows: [] };
    const count = (list: { name: string; n: number }[], name: string) => list.find((row) => row.name === name)?.n ?? 0;
    return {
      applicationsByCohort: byCohort.rows,
      accounts: Object.fromEntries(accounts.rows.map((row) => [row.status, row.n])),
      subscriptions: {
        activeDevices: devices.rows[0]!.total,
        linkedToAccounts: devices.rows[0]!.linked,
        anonymous: devices.rows[0]!.total - devices.rows[0]!.linked,
        byTopic: subs.rows,
      },
      campaignsLast30Days: Object.fromEntries(campaigns.rows.map((row) => [row.status, row.n])),
      deliveriesLast30Days: Object.fromEntries(deliveries.rows.map((row) => [row.status, row.n])),
      productLast30Days: {
        observedInstalls: count(events.rows, 'app_installed'),
        installPromptAccepted: count(events.rows, 'install_prompt_accepted'),
        installPromptDismissed: count(events.rows, 'install_prompt_dismissed'),
        standaloneLaunches: count(events.rows, 'standalone_launch'),
        notificationOptIns: count(events.rows, 'push_opt_in'),
        notificationOptOuts: count(events.rows, 'push_opt_out'),
        recordedNotificationClicks: count(events.rows, 'notification_click'),
        applicationsSubmitted: count(events.rows, 'application_submitted'),
      },
      queue: {
        ...(await queueStats(db)),
        // The raw error text is for staff who look after the platform; others see that a job failed.
        recentFailures: failedJobs.rows.map((row) => ({ kind: row.kind, last_error: errorDetail ? row.last_error : null, updated_at: iso(row.updated_at) })),
      },
      recentActions: recent.rows.map((row) => ({ at: iso(row.created_at), action: row.action, actor: row.actor_name ?? 'Former staff member' })),
      health: await integrationHealth(services),
    };
  });
}
