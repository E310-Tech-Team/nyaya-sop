/**
 * Applicant administration (/api/admin/applicants). Reviewers only ever see applications
 * assigned to them. Viewing a record, exporting, status changes, publication, corrections and
 * deletion are all audited (identifiers and field names only, never the personal data).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AGE_RANGES,
  CURRENT_STATUSES,
  EDUCATION_LEVELS,
  PURPOSE_SCALE,
  STORED_GENDERS,
  labelFor,
  referenceFromId,
  type FieldErrors,
  type PersonalAnswers,
} from '../../src/shared/application';
import { CHURCH_LEVELS } from '../../src/shared/directory';
import { can } from '../../src/shared/permissions';
import {
  PUBLISHED_STATUS_LABELS,
  REVIEW_TRANSITIONS,
  isApplicationStatus,
  type ApplicationStatus,
} from '../../src/shared/platform';
import { cleanText, normalizeEmail, normalizePhone, validatePersonal } from '../../src/shared/validation';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import { staffActor } from '../auth/staff-routes';
import { applicationsToCsv } from '../csv';
import { inTransaction } from '../directory/store';
import { iso, isUuid, paging, sendError, str } from '../http';
import { notifyApplicationUpdate } from '../notifications/dispatch';
import { parishDetails } from '../parishes';
import type { ApplicationExportRow } from '../repository';
import type { Services } from '../services';
import { applicationConditions, FILTER_KEYS, filterNames, type ApplicationFilters } from './application-filters';
import { linkApplicationParish, ParishLinkError } from './parish-links';

type Filters = ApplicationFilters & { q?: string; reviewer?: string; claimed?: string; sort?: string };

/** What staff may correct in an application (`POST /:id/correct`): contact details and the typed parish. */
const CORRECTABLE_FIELDS = ['fullName', 'email', 'phone', 'stateOfResidence', 'city', 'parishName'] as const;
type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

const SORTS: Record<string, string> = {
  newest: 'a.created_at desc, a.id',
  oldest: 'a.created_at asc, a.id',
  name: 'a.full_name asc, a.id',
  status: 'a.status asc, a.created_at desc, a.id',
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** WHERE clause + params for the list and the export. Reviewers are always limited to their own assignments. */
function whereFor(request: FastifyRequest, filters: Filters) {
  const staff = request.staff!;
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (p: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(sql(`$${params.length}`));
  };
  if (!can(staff.role, 'applications.view_all')) add((p) => `a.assigned_reviewer_id = ${p}`, staff.id);
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const reference = /^SOP-?([0-9A-F]{1,8})$/i.exec(q);
    if (reference) add((p) => `replace(a.id::text, '-', '') ilike ${p}`, `${reference[1]!.toLowerCase()}%`);
    else {
      const like = `%${escapeLike(q)}%`;
      add((p) => `(a.full_name ilike ${p} or a.email ilike ${p} or a.city ilike ${p} or a.parish_name ilike ${p} or p.display_name ilike ${p})`, like);
    }
  }
  if (filters.reviewer === 'me') add((p) => `a.assigned_reviewer_id = ${p}`, staff.id);
  else if (filters.reviewer === 'unassigned') clauses.push('a.assigned_reviewer_id is null');
  else if (isUuid(filters.reviewer)) add((p) => `a.assigned_reviewer_id = ${p}`, filters.reviewer);
  if (filters.claimed === 'yes') clauses.push('a.account_id is not null');
  if (filters.claimed === 'no') clauses.push('a.account_id is null');
  // Cohort, statuses, dates and parish: the same conditions Reports counts with.
  const shared = applicationConditions(filters, params.length);
  clauses.push(...shared.clauses);
  params.push(...shared.params);
  return { where: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
}

// The application's current parish, and the unit that places it: its province, or the region or
// continent it sits directly under. The list and the export join it as `p` (the filters use it).
const PARISH_JOIN = `left join parishes p on p.id = a.parish_id
         left join church_units place on place.id = coalesce(p.province_id, p.region_id, p.continent_id)`;

export async function applicantRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const canView = staffGuard(services, { permission: ['applications.view_all', 'applications.view_assigned'] });

  /** The application, if this staff member may see it. */
  const visible = async (request: FastifyRequest, id: string) => {
    if (!isUuid(id)) return null;
    const { rows } = await db.query<{ id: string; assigned_reviewer_id: string | null; status: ApplicationStatus; account_id: string | null }>(
      'select id, assigned_reviewer_id, status::text as status, account_id from applications where id = $1',
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const staff = request.staff!;
    if (!can(staff.role, 'applications.view_all') && row.assigned_reviewer_id !== staff.id) return null;
    return row;
  };

  app.get<{ Querystring: Filters & { page?: string; pageSize?: string } }>('/', { preHandler: canView }, async (request) => {
    const { page, pageSize, offset } = paging(request.query);
    const { where, params } = whereFor(request, request.query);
    const sort = request.query.sort ?? 'newest';
    const order = Object.hasOwn(SORTS, sort) ? SORTS[sort]! : SORTS.newest!; // not "constructor" and the like
    const { rows } = await db.query<{
      id: string;
      full_name: string;
      email: string;
      city: string;
      state_of_residence: string;
      cohort_name: string;
      created_at: Date;
      status: ApplicationStatus;
      published_status: ApplicationStatus;
      reviewer_id: string | null;
      reviewer_name: string | null;
      claimed: boolean;
      notes: number;
      parish_status: string;
      parish_name: string | null;
      parish_id: string | null;
      parish_display: string | null;
      parish_place: string | null;
      total: number;
    }>(
      `select a.id, a.full_name, a.email, a.city, a.state_of_residence, c.name as cohort_name, a.created_at,
              a.status::text as status, a.published_status::text as published_status,
              a.assigned_reviewer_id as reviewer_id, r.display_name as reviewer_name, a.account_id is not null as claimed,
              (select count(*)::int from application_notes n where n.application_id = a.id) as notes,
              a.parish_status::text as parish_status, a.parish_name, a.parish_id, p.display_name as parish_display, place.display_name as parish_place,
              count(*) over ()::int as total
         from applications a
         join cohorts c on c.id = a.cohort_id
         left join staff_users r on r.id = a.assigned_reviewer_id
         ${PARISH_JOIN}
         ${where}
        order by ${order}
        limit ${pageSize} offset ${offset}`,
      params,
    );
    return {
      page,
      pageSize,
      total: rows[0]?.total ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        reference: referenceFromId(row.id),
        fullName: row.full_name,
        email: row.email,
        location: `${row.city}, ${row.state_of_residence}`,
        cohortName: row.cohort_name,
        submittedAt: iso(row.created_at),
        status: row.status,
        publishedStatus: row.published_status,
        reviewer: row.reviewer_id ? { id: row.reviewer_id, name: row.reviewer_name } : null,
        claimed: row.claimed,
        notes: row.notes,
        parish: {
          status: row.parish_status,
          answer: row.parish_name,
          linked: row.parish_id ? { id: row.parish_id, name: row.parish_display!, place: row.parish_place } : null,
        },
      })),
    };
  });

  app.get<{ Querystring: Filters }>('/export.csv', { preHandler: staffGuard(services, { permission: 'applications.export' }), config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    const { where, params } = whereFor(request, request.query);
    const { rows } = await db.query<ApplicationExportRow>(
      `select a.id, a.created_at, c.slug as cohort_slug, a.status::text as status, a.published_status::text as published_status,
              a.full_name, a.email, a.phone_e164, a.gender::text as gender, a.age_range::text as age_range, a.state_of_residence,
              a.city, a.parish_name, a.education_level::text as education_level, a.current_status::text as current_status,
              a.purpose_clarity, a.consent_version, a.consent_at, a.submission_meta,
              a.parish_status::text as parish_status, p.display_name as directory_parish,
              prov.display_name as province, reg.display_name as region, cont.display_name as continent
         from applications a join cohorts c on c.id = a.cohort_id
         ${PARISH_JOIN}
         left join church_units prov on prov.id = p.province_id
         left join church_units reg on reg.id = p.region_id
         left join church_units cont on cont.id = p.continent_id
         ${where}
        order by a.created_at`,
      params,
    );
    await audit(db, staffActor(request.staff!), 'applications.exported', null, {
      rows: rows.length,
      filters: filterNames(request.query as Record<string, unknown>, [...FILTER_KEYS, 'q', 'reviewer', 'claimed', 'sort']),
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="sop-applications-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('cache-control', 'no-store')
      .send(`﻿${applicationsToCsv(rows)}`);
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: canView }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const { rows } = await db.query<Record<string, unknown> & { id: string; created_at: Date }>(
      `select a.*, a.status::text as status, a.published_status::text as published_status, a.gender::text as gender,
              a.age_range::text as age_range, a.education_level::text as education_level, a.current_status::text as current_status,
              a.parish_status::text as parish_status, c.name as cohort_name, c.slug as cohort_slug, r.display_name as reviewer_name,
              acc.email as account_email, acc.status::text as account_status, linker.display_name as parish_linked_by_name
         from applications a join cohorts c on c.id = a.cohort_id
         left join staff_users r on r.id = a.assigned_reviewer_id
         left join applicant_accounts acc on acc.id = a.account_id
         left join staff_users linker on linker.id = a.parish_linked_by
        where a.id = $1`,
      [allowed.id],
    );
    const a = rows[0]!;
    const reports = await db.query<{
      id: string;
      kind: string;
      status: string;
      reported_name: string | null;
      created_at: Date;
      resolved_at: Date | null;
      resolved_by: string | null;
      resolved_parish: string | null;
    }>(
      `select r.id, r.kind::text as kind, r.status::text as status, r.reported_name, r.created_at, r.resolved_at,
              s.display_name as resolved_by, rp.display_name as resolved_parish
         from parish_reports r
         left join staff_users s on s.id = r.resolved_by
         left join parishes rp on rp.id = r.resolved_parish_id
        where r.application_id = $1 order by r.created_at`,
      [allowed.id],
    );
    const current = a.parish_id ? await parishDetails(db, a.parish_id as string) : null;
    const snapshot = a.parish_snapshot as ({ parish: { id: string; name: string } } & Record<string, unknown>) | null;
    const place = a.parish_place_snapshot as ({ unit: { id: string; name: string; level: string } } & Record<string, unknown>) | null;
    const notes = await db.query<{ id: string; body: string; created_at: Date; author: string | null }>(
      `select n.id, n.body, n.created_at, s.display_name as author from application_notes n
         left join staff_users s on s.id = n.author_id where n.application_id = $1 order by n.created_at`,
      [allowed.id],
    );
    const history = await db.query<{ kind: string; from_status: string | null; to_status: string; created_at: Date; actor: string | null }>(
      `select e.kind, e.from_status::text as from_status, e.to_status::text as to_status, e.created_at, s.display_name as actor
         from application_status_events e left join staff_users s on s.id = e.actor_id
        where e.application_id = $1 order by e.created_at`,
      [allowed.id],
    );
    await audit(db, staffActor(request.staff!), 'application.viewed', { type: 'application', id: allowed.id });
    const meta = (a.submission_meta ?? {}) as Record<string, string>;
    return {
      id: a.id,
      reference: referenceFromId(a.id),
      cohort: { id: a.cohort_id, name: a.cohort_name, slug: a.cohort_slug },
      submittedAt: iso(a.created_at),
      personal: {
        fullName: a.full_name,
        email: a.email,
        phone: a.phone_e164,
        // An earlier application may hold an answer the form no longer offers: labelled, not hidden.
        gender: labelFor(STORED_GENDERS, a.gender),
        ageRange: labelFor(AGE_RANGES, a.age_range),
        stateOfResidence: a.state_of_residence,
        city: a.city,
        parishName: a.parish_name,
      },
      education: { educationLevel: labelFor(EDUCATION_LEVELS, a.education_level), currentStatus: labelFor(CURRENT_STATUSES, a.current_status) },
      purposeClarity: `${a.purpose_clarity} – ${labelFor(PURPOSE_SCALE, a.purpose_clarity)}`,
      consent: { version: a.consent_version, at: iso(a.consent_at as Date) },
      attribution: { utmSource: meta.utmSource ?? null, utmMedium: meta.utmMedium ?? null, utmCampaign: meta.utmCampaign ?? null, referrer: meta.referrer ?? null },
      status: a.status,
      allowedTransitions: REVIEW_TRANSITIONS[a.status as ApplicationStatus],
      published: {
        status: a.published_status,
        label: PUBLISHED_STATUS_LABELS[a.published_status as ApplicationStatus].label,
        message: a.published_message,
        at: iso(a.published_at as Date | null),
      },
      reviewer: a.assigned_reviewer_id ? { id: a.assigned_reviewer_id, name: a.reviewer_name } : null,
      account: a.account_id ? { email: a.account_email, status: a.account_status, claimedAt: iso(a.claimed_at as Date) } : null,
      notes: notes.rows.map((note) => ({ id: note.id, body: note.body, createdAt: iso(note.created_at), author: note.author ?? 'Former staff member' })),
      history: history.rows.map((event) => ({ ...event, created_at: iso(event.created_at) })),
      parish: {
        status: a.parish_status,
        /** What the applicant typed, or the directory's name for the parish they chose (as it was then). */
        answer: a.parish_name,
        /** The application's parish in today's directory (chosen by the applicant or linked by staff). */
        current,
        /** The parish, province, region and continent as the applicant confirmed them. */
        submitted: snapshot
          ? {
              parish: snapshot.parish,
              chain: Object.fromEntries(CHURCH_LEVELS.map((level) => [level, snapshot[level] ?? null])),
              // A look-alike choice (D-55): how many same-named parishes it stood for.
              lookalikes: Array.isArray(snapshot.lookalikes) ? snapshot.lookalikes.length : null,
            }
          : null,
        /** "Not listed" after choosing a province (D-59): the place they chose, as the directory named it then. */
        place: place ? { unit: place.unit, chain: Object.fromEntries(CHURCH_LEVELS.map((level) => [level, place[level] ?? null])) } : null,
        linkedBy: a.parish_linked_at ? { name: (a.parish_linked_by_name as string | null) ?? 'Former staff member', at: iso(a.parish_linked_at as Date) } : null,
        textReviewedAt: iso(a.parish_text_reviewed_at as Date | null),
        reports: reports.rows.map((report) => ({
          id: report.id,
          kind: report.kind,
          status: report.status,
          reportedName: report.reported_name,
          createdAt: iso(report.created_at),
          resolvedAt: iso(report.resolved_at),
          resolvedBy: report.resolved_at ? (report.resolved_by ?? 'Former staff member') : null,
          resolvedParish: report.resolved_parish,
        })),
      },
    };
  });

  /** Sets the application's parish from the directory (or, with null, removes a link staff made). */
  app.post<{ Params: { id: string } }>('/:id/parish', { preHandler: staffGuard(services, { permission: 'applications.edit' }) }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const parishId = (request.body as { parishId?: unknown } | null)?.parishId;
    if (parishId !== null && !isUuid(parishId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a parish from the directory.');
    try {
      const result = await inTransaction(db, (connection) => linkApplicationParish(connection, allowed.id, parishId, request.staff!.id));
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof ParishLinkError) return sendError(reply, 400, 'VALIDATION_FAILED', error.message);
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/:id/notes', { preHandler: staffGuard(services, { permission: 'applications.note' }) }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const body = str(request.body, 'body', 4000);
    if (!body) return sendError(reply, 400, 'VALIDATION_FAILED', 'Write a note (up to 4,000 characters).');
    const { rows } = await db.query<{ id: string }>('insert into application_notes (application_id, author_id, body) values ($1, $2, $3) returning id', [
      allowed.id,
      request.staff!.id,
      body,
    ]);
    await audit(db, staffActor(request.staff!), 'application.note_added', { type: 'application', id: allowed.id });
    return reply.code(201).send({ id: rows[0]!.id });
  });

  app.post<{ Params: { id: string } }>('/:id/assign', { preHandler: staffGuard(services, { permission: 'applications.assign' }) }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const reviewerId = (request.body as { reviewerId?: unknown } | null)?.reviewerId;
    if (reviewerId !== null) {
      const { rows } = isUuid(reviewerId)
        ? await db.query(`select id from staff_users where id = $1 and status = 'active' and role in ('reviewer', 'programme_admin', 'owner')`, [reviewerId])
        : { rows: [] };
      if (!rows.length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose an active reviewer.');
    }
    await db.query('update applications set assigned_reviewer_id = $2 where id = $1', [allowed.id, reviewerId]);
    await audit(db, staffActor(request.staff!), 'application.assigned', { type: 'application', id: allowed.id }, { reviewerId });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/status', { preHandler: staffGuard(services, { permission: 'applications.review' }) }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const next = (request.body as { status?: unknown } | null)?.status;
    if (!isApplicationStatus(next) || !REVIEW_TRANSITIONS[allowed.status].includes(next)) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'That status change isn’t allowed from the current status.');
    }
    // Compare-and-set, so two reviewers changing it at once can't both apply a transition.
    const { rows } = await db.query(
      `update applications set status = $3::application_status, status_changed_at = now()
        where id = $1 and status = $2::application_status returning id`,
      [allowed.id, allowed.status, next],
    );
    if (!rows.length) return sendError(reply, 409, 'CONFLICT', 'Someone else changed this application. Reload to see the latest status.');
    await db.query(
      `insert into application_status_events (application_id, kind, from_status, to_status, actor_id) values ($1, 'review', $2, $3, $4)`,
      [allowed.id, allowed.status, next, request.staff!.id],
    );
    await audit(db, staffActor(request.staff!), 'application.status_changed', { type: 'application', id: allowed.id }, { from: allowed.status, to: next });
    return { ok: true, status: next };
  });

  /** Publishes the current internal status (and an optional message) to the applicant. */
  app.post<{ Params: { id: string } }>('/:id/publish', { preHandler: staffGuard(services, { permission: 'applications.publish' }) }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const body = request.body as { expectedStatus?: unknown; message?: unknown } | null;
    if (body?.expectedStatus !== allowed.status) {
      return sendError(reply, 409, 'CONFLICT', 'The review status changed since you opened this. Reload and check before publishing.');
    }
    const message = typeof body?.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 1000) : null;
    // Only the status the publisher saw: if someone changed it since, nothing is published.
    const { rows: published } = await db.query(
      `update applications set published_status = status, published_message = $2, published_at = now(), published_by = $3
        where id = $1 and status = $4::application_status returning id`,
      [allowed.id, message, request.staff!.id, allowed.status],
    );
    if (!published.length) return sendError(reply, 409, 'CONFLICT', 'The review status changed since you opened this. Reload and check before publishing.');
    await db.query(
      `insert into application_status_events (application_id, kind, from_status, to_status, actor_id)
       select $1, 'publication', null, status, $2 from applications where id = $1`,
      [allowed.id, request.staff!.id],
    );
    await audit(db, staffActor(request.staff!), 'application.decision_published', { type: 'application', id: allowed.id }, {
      status: allowed.status,
      withMessage: Boolean(message),
    });
    if (allowed.account_id) await notifyApplicationUpdate(services, allowed.id, allowed.account_id);
    return { ok: true, notified: Boolean(allowed.account_id) };
  });

  /**
   * Data correction of contact details (`CORRECTABLE_FIELDS`), validated with the same rules as the
   * form. Gender and age range stay as the applicant answered: a `gender` in the body is ignored.
   */
  app.post<{ Params: { id: string } }>('/:id/correct', { preHandler: staffGuard(services, { permission: 'applications.edit' }) }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const { rows } = await db.query<{ full_name: string; email: string; phone_e164: string; state_of_residence: string; city: string; parish_name: string | null; parish_status: string }>(
      `select full_name, email, phone_e164, state_of_residence, city, parish_name, parish_status::text as parish_status
         from applications where id = $1`,
      [allowed.id],
    );
    const current = rows[0]!;
    const input = (request.body ?? {}) as Partial<Record<CorrectableField, unknown>>;
    const merged: PersonalAnswers = {
      fullName: typeof input.fullName === 'string' ? input.fullName : current.full_name,
      email: typeof input.email === 'string' ? input.email : current.email,
      phone: typeof input.phone === 'string' ? input.phone : current.phone_e164,
      // Not corrected here, so not checked below.
      gender: '',
      ageRange: '',
      stateOfResidence: typeof input.stateOfResidence === 'string' ? input.stateOfResidence : current.state_of_residence,
      city: typeof input.city === 'string' ? input.city : current.city,
      parishName: typeof input.parishName === 'string' ? input.parishName : (current.parish_name ?? ''),
    };
    // Only the correctable fields are checked: an earlier application's stored gender may be one
    // the form no longer offers ("Prefer not to say"), and that mustn't block fixing an email address.
    const found = validatePersonal(merged);
    const errors: FieldErrors = {};
    for (const field of CORRECTABLE_FIELDS) if (found[field]) errors[field] = found[field];
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors });
    const next = {
      full_name: cleanText(merged.fullName),
      email: normalizeEmail(merged.email),
      phone_e164: normalizePhone(merged.phone)!,
      state_of_residence: merged.stateOfResidence,
      city: cleanText(merged.city),
      parish_name: cleanText(merged.parishName) || null,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== current[key]);
    if (!changed.length) return { ok: true, changed };
    // A parish chosen from the directory, or reported as not listed, is changed in Parish review.
    if (changed.includes('parish_name') && (current.parish_status === 'listed' || current.parish_status === 'reported')) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', {
        fieldErrors: { parishName: 'This parish comes from the parish directory, so it can’t be edited as text.' },
      });
    }
    try {
      await db.query(
        `update applications
            set full_name = $2, email = $3, phone_e164 = $4, state_of_residence = $5, city = $6, parish_name = $7::text,
                parish_status = case
                  when parish_status in ('legacy_text', 'not_provided')
                    then (case when $7::text is null then 'not_provided' else 'legacy_text' end)::application_parish_status
                  else parish_status end
          where id = $1`,
        [allowed.id, next.full_name, next.email, next.phone_e164, next.state_of_residence, next.city, next.parish_name],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return sendError(reply, 409, 'CONFLICT', 'Another application in this cohort already uses that email address.');
      }
      throw error;
    }
    await audit(db, staffActor(request.staff!), 'application.corrected', { type: 'application', id: allowed.id }, { fields: changed });
    return { ok: true, changed };
  });

  /** Deletes an application and its notes and history. Needs the reference typed back. */
  app.post<{ Params: { id: string } }>('/:id/delete', { preHandler: staffGuard(services, { permission: 'applications.edit' }) }, async (request, reply) => {
    const allowed = await visible(request, request.params.id);
    if (!allowed) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const reference = referenceFromId(allowed.id);
    if (str(request.body, 'confirm', 20)?.toUpperCase() !== reference) {
      return sendError(reply, 400, 'VALIDATION_FAILED', `Type ${reference} to confirm.`);
    }
    await db.query('delete from applications where id = $1', [allowed.id]);
    await audit(db, staffActor(request.staff!), 'application.deleted', { type: 'application', id: allowed.id }, { reference });
    return { ok: true };
  });
}
