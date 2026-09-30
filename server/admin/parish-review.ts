/**
 * Parish review (/api/admin/parish-review): parishes applicants couldn't find, "details look
 * wrong" flags, look-alike choices ("which parish?", D-55), and earlier free-text answers, each
 * with suggested matches. Staff link the
 * application to a parish, add the parish, correct the directory, or close the item. It shows
 * applicants' names and changes both applications and the directory, so every route needs
 * applications.view_all, applications.edit and directory.manage.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { referenceFromId } from '../../src/shared/application';
import { CHURCH_LEVELS, parishKey, type ParishChain } from '../../src/shared/directory';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import { staffActor } from '../auth/staff-routes';
import type { Queryable } from '../db';
import { createParishIn } from '../directory/edits';
import { DirectoryError, inTransaction } from '../directory/store';
import { iso, isUuid, paging, sendError, str } from '../http';
import { lookalikeGroup, parishDetails, searchParishes } from '../parishes';
import { directoryNamespace, type Services } from '../services';
import { linkApplicationParish, ParishLinkError } from './parish-links';

export const REVIEW_KINDS = ['not_listed', 'details_wrong', 'lookalike', 'earlier_text'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

// An earlier free-text answer still waiting: typed on the old form, not linked, not yet looked at.
const WAITING_TEXT = `a.parish_status = 'legacy_text' and a.parish_id is null and a.parish_text_reviewed_at is null`;
// Most items the bulk confirmation handles at once.
const BATCH_LIMIT = 500;

class ReviewConflict extends Error {}

/**
 * For each answer, the one active parish in the applicant's state with exactly that name (or
 * one of its other spellings). Answers matching none, or several, get nothing: staff decide those.
 */
export async function exactMatches(db: Queryable, answers: { applicationId: string; name: string; state: string }[]): Promise<Map<string, string>> {
  const wanted = answers.map((answer) => ({ application_id: answer.applicationId, key: parishKey(answer.name), state: answer.state })).filter((row) => row.key);
  if (!wanted.length) return new Map();
  const { rows } = await db.query<{ application_id: string; parish_id: string }>(
    `with wanted as (select * from jsonb_to_recordset($1::jsonb) as w(application_id uuid, key text, state text)),
          found as (
            select w.application_id, p.id as parish_id
              from wanted w
              join parishes p on p.name_key = w.key and p.status = 'active'
              join church_units prov on prov.id = p.province_id and prov.state = w.state
            union
            select w.application_id, p.id
              from wanted w
              join parish_aliases al on al.alias_key = w.key
              join parishes p on p.id = al.parish_id and p.status = 'active'
              join church_units prov on prov.id = p.province_id and prov.state = w.state)
     select application_id, min(parish_id::text) as parish_id from found group by application_id having count(distinct parish_id) = 1`,
    [JSON.stringify(wanted)],
  );
  return new Map(rows.map((row) => [row.application_id, row.parish_id]));
}

type ApplicantRow = { application_id: string; full_name: string; state_of_residence: string; cohort: string; created_at: Date };
const applicantOf = (row: ApplicantRow) => ({
  id: row.application_id,
  reference: referenceFromId(row.application_id),
  fullName: row.full_name,
  state: row.state_of_residence,
  cohort: row.cohort,
});

const chainFrom = (snapshot: Record<string, unknown> | null): ParishChain | null =>
  snapshot ? (Object.fromEntries(CHURCH_LEVELS.map((level) => [level, snapshot[level] ?? null])) as ParishChain) : null;

/**
 * The parishes a look-alike choice could mean: the active parishes sharing the linked parish's
 * name in its unit (as the directory has them now), each with its RCCG code, how many applications
 * are linked to it, and whether it's the one this application is linked to.
 */
async function candidatesOf(db: Queryable, parishId: string, applicationId: string) {
  const group = await lookalikeGroup(db, parishId);
  if (!group.length) return [];
  const { rows } = await db.query<{ id: string; name: string; external_id: string | null; applications: number; linked: boolean }>(
    `select p.id, p.display_name as name, p.external_id,
            (select count(*)::int from applications x where x.parish_id = p.id) as applications,
            exists (select 1 from applications a where a.id = $2 and a.parish_id = p.id) as linked
       from parishes p where p.id = any($1::uuid[])`,
    [group, applicationId],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return group.flatMap((id) => {
    const row = byId.get(id);
    return row
      ? [{ id: row.id, name: row.name, code: row.external_id ? row.external_id.slice(row.external_id.lastIndexOf(':') + 1) : null, applications: row.applications, linked: row.linked }]
      : [];
  });
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof DirectoryError || error instanceof ParishLinkError) return sendError(reply, 400, 'VALIDATION_FAILED', error.message);
  if (error instanceof ReviewConflict) return sendError(reply, 409, 'CONFLICT', error.message);
  throw error;
}

export async function parishReviewRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const guard = staffGuard(services, { allOf: ['applications.view_all', 'applications.edit', 'directory.manage'] });

  app.get<{ Querystring: { kind?: string; page?: string; pageSize?: string } }>('/', { preHandler: guard }, async (request) => {
    const counts = (
      await db.query<Record<ReviewKind, number>>(
        `select (select count(*)::int from parish_reports where status = 'pending' and kind = 'not_listed') as not_listed,
                (select count(*)::int from parish_reports where status = 'pending' and kind = 'details_wrong') as details_wrong,
                (select count(*)::int from parish_reports where status = 'pending' and kind = 'lookalike') as lookalike,
                (select count(*)::int from applications a where ${WAITING_TEXT}) as earlier_text`,
      )
    ).rows[0]!;
    const kind: ReviewKind = REVIEW_KINDS.includes(request.query.kind as ReviewKind) ? (request.query.kind as ReviewKind) : 'not_listed';
    const { page, pageSize, offset } = paging(request.query, 50);

    if (kind === 'earlier_text') {
      const { rows } = await db.query<ApplicantRow & { parish_name: string; total: number }>(
        `select a.id as application_id, a.full_name, a.state_of_residence, c.name as cohort, a.created_at, a.parish_name,
                count(*) over ()::int as total
           from applications a join cohorts c on c.id = a.cohort_id
          where ${WAITING_TEXT}
          order by a.created_at, a.id limit ${pageSize} offset ${offset}`,
      );
      const exact = await exactMatches(db, rows.map((row) => ({ applicationId: row.application_id, name: row.parish_name, state: row.state_of_residence })));
      const items = [];
      for (const row of rows) {
        items.push({
          id: row.application_id,
          kind,
          createdAt: iso(row.created_at),
          application: applicantOf(row),
          name: row.parish_name,
          parish: null,
          submitted: null,
          suggestions: (await searchParishes(db, row.parish_name, row.state_of_residence, 3, directoryNamespace(services))).results,
          exactMatch: exact.get(row.application_id) ?? null,
          candidates: null,
        });
      }
      return { counts, kind, page, pageSize, total: rows[0]?.total ?? 0, items };
    }

    const { rows } = await db.query<ApplicantRow & { id: string; reported_name: string | null; parish_id: string | null; parish_snapshot: Record<string, unknown> | null; total: number }>(
      `select r.id, r.reported_name, r.parish_id, r.created_at, a.id as application_id, a.full_name, a.state_of_residence, a.parish_snapshot,
              c.name as cohort, count(*) over ()::int as total
         from parish_reports r join applications a on a.id = r.application_id join cohorts c on c.id = a.cohort_id
        where r.status = 'pending' and r.kind = $1::parish_report_kind
        order by r.created_at, r.id limit ${pageSize} offset ${offset}`,
      [kind],
    );
    const items = [];
    for (const row of rows) {
      items.push({
        id: row.id,
        kind,
        createdAt: iso(row.created_at),
        application: applicantOf(row),
        name: row.reported_name,
        parish: row.parish_id ? await parishDetails(db, row.parish_id) : null,
        submitted: kind === 'details_wrong' ? chainFrom(row.parish_snapshot) : null,
        suggestions: row.reported_name ? (await searchParishes(db, row.reported_name, row.state_of_residence, 3, directoryNamespace(services))).results : [],
        exactMatch: null,
        candidates: kind === 'lookalike' && row.parish_id ? await candidatesOf(db, row.parish_id, row.application_id) : null,
      });
    }
    return { counts, kind, page, pageSize, total: rows[0]?.total ?? 0, items };
  });

  /**
   * Resolves an applicant's report: link the application to a listed parish, add the parish they
   * couldn't find (and link it), mark the directory fixed, or close it with no change.
   */
  app.post<{ Params: { id: string } }>('/reports/:id/resolve', { preHandler: guard }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'There is no report with that ID.');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const action = body.action;
    if (action !== 'link' && action !== 'add' && action !== 'fixed' && action !== 'reject') return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose what to do with this report.');
    if (action === 'link' && !isUuid(body.parishId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a parish from the directory.');
    if (action === 'add' && !isUuid(body.unitId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose the province, region or continent the parish is in.');
    const staff = request.staff!;
    try {
      const parishId = await inTransaction(db, async (connection) => {
        const { rows } = await connection.query<{ application_id: string; kind: string; status: string; parish_id: string | null }>(
          `select application_id, kind::text as kind, status::text as status, parish_id from parish_reports where id = $1 for update`,
          [request.params.id],
        );
        const report = rows[0];
        if (!report) throw new DirectoryError('There is no report with that ID.');
        if (report.status !== 'pending') throw new ReviewConflict('Someone has already dealt with this report. Reload to see the latest.');
        let linked: string | null = null;
        if (action === 'link') {
          linked = body.parishId as string;
          await linkApplicationParish(connection, report.application_id, linked, staff.id);
          // Linking to the parish it already has changes nothing else, but still settles the report.
          await connection.query(
            `update parish_reports set status = 'linked', resolved_parish_id = $2, resolved_by = $3, resolved_at = now() where id = $1 and status = 'pending'`,
            [request.params.id, linked, staff.id],
          );
        } else if (action === 'add') {
          if (report.kind !== 'not_listed') throw new DirectoryError('Only a parish that isn’t listed can be added from here.');
          linked = await createParishIn(connection, { unitId: body.unitId as string, name: str(body, 'name', 200) ?? '' }, staff.id);
          await linkApplicationParish(connection, report.application_id, linked, staff.id);
          await connection.query(`update parish_reports set status = 'added' where id = $1`, [request.params.id]);
        } else {
          if (action === 'fixed' && report.kind !== 'details_wrong') throw new DirectoryError('Only a “details look wrong” flag can be marked fixed.');
          await connection.query(
            `update parish_reports set status = $2::parish_report_status, resolved_parish_id = $3, resolved_by = $4, resolved_at = now() where id = $1`,
            [request.params.id, action === 'fixed' ? 'fixed' : 'rejected', action === 'fixed' ? report.parish_id : null, staff.id],
          );
        }
        await audit(connection, staffActor(staff), 'parish_review.resolved', { type: 'parish_report', id: request.params.id }, { action, parishId: linked });
        return linked;
      });
      return { ok: true, parishId };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** Links an earlier free-text answer to a parish. */
  app.post<{ Params: { id: string } }>('/earlier/:id/link', { preHandler: guard }, async (request, reply) => {
    const parishId = (request.body as { parishId?: unknown } | null)?.parishId;
    if (!isUuid(request.params.id) || !isUuid(parishId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a parish from the directory.');
    try {
      await inTransaction(db, async (connection) => {
        const waiting = await connection.query(`select 1 from applications a where a.id = $1 and ${WAITING_TEXT} for update`, [request.params.id]);
        if (!waiting.rows.length) throw new ReviewConflict('This answer has already been dealt with. Reload to see the latest.');
        await linkApplicationParish(connection, request.params.id, parishId, request.staff!.id);
        await audit(connection, staffActor(request.staff!), 'parish_review.resolved', { type: 'application', id: request.params.id }, { action: 'link', parishId });
      });
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** Staff looked at an earlier free-text answer and couldn't match it: it leaves the queue. */
  app.post<{ Params: { id: string } }>('/earlier/:id/dismiss', { preHandler: guard }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Application not found.');
    const { rows } = await db.query(`update applications a set parish_text_reviewed_at = now() where a.id = $1 and ${WAITING_TEXT} returning a.id`, [request.params.id]);
    if (!rows.length) return sendError(reply, 409, 'CONFLICT', 'This answer has already been dealt with. Reload to see the latest.');
    await audit(db, staffActor(request.staff!), 'parish_review.resolved', { type: 'application', id: request.params.id }, { action: 'dismiss' });
    return { ok: true };
  });

  /** Earlier answers that match exactly one parish in the applicant's state, for staff to confirm together. */
  app.get('/earlier/matches', { preHandler: guard }, async () => {
    const { rows } = await db.query<ApplicantRow & { parish_name: string }>(
      `select a.id as application_id, a.full_name, a.state_of_residence, c.name as cohort, a.created_at, a.parish_name
         from applications a join cohorts c on c.id = a.cohort_id
        where ${WAITING_TEXT} order by a.created_at, a.id limit 5000`,
    );
    const exact = await exactMatches(db, rows.map((row) => ({ applicationId: row.application_id, name: row.parish_name, state: row.state_of_residence })));
    const matched = rows.filter((row) => exact.has(row.application_id)).slice(0, BATCH_LIMIT);
    const parishes = await db.query<{ id: string; name: string; place: string | null }>(
      `select p.id, p.display_name as name, u.display_name as place from parishes p
         left join church_units u on u.id = coalesce(p.province_id, p.region_id, p.continent_id)
        where p.id in (select value::uuid from jsonb_array_elements_text($1::jsonb))`,
      [JSON.stringify([...new Set(matched.map((row) => exact.get(row.application_id)!))])],
    );
    const byId = new Map(parishes.rows.map((row) => [row.id, row]));
    return {
      total: exact.size,
      items: matched.map((row) => ({ application: applicantOf(row), name: row.parish_name, parish: byId.get(exact.get(row.application_id)!)! })),
    };
  });

  /** Links the confirmed matches, checking each is still waiting and still the only exact match. */
  // Up to BATCH_LIMIT pairs of IDs (about 110 bytes each): more than the default 16 KB body.
  app.post('/earlier/confirm', { preHandler: guard, bodyLimit: 64 * 1024 }, async (request, reply) => {
    const items = (request.body as { items?: unknown } | null)?.items;
    if (!Array.isArray(items) || !items.length || items.length > BATCH_LIMIT) return sendError(reply, 400, 'VALIDATION_FAILED', `Confirm between 1 and ${BATCH_LIMIT} matches at a time.`);
    const pairs = items.filter((item): item is { applicationId: string; parishId: string } => isUuid(item?.applicationId) && isUuid(item?.parishId));
    if (pairs.length !== items.length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Each match needs an application and a parish.');
    const staff = request.staff!;
    const result = await inTransaction(db, async (connection) => {
      const { rows } = await connection.query<{ id: string; parish_name: string; state_of_residence: string }>(
        `select a.id, a.parish_name, a.state_of_residence from applications a
          where a.id in (select value::uuid from jsonb_array_elements_text($1::jsonb)) and ${WAITING_TEXT} for update`,
        [JSON.stringify(pairs.map((pair) => pair.applicationId))],
      );
      const exact = await exactMatches(connection, rows.map((row) => ({ applicationId: row.id, name: row.parish_name, state: row.state_of_residence })));
      let linked = 0;
      for (const pair of pairs) {
        if (exact.get(pair.applicationId) !== pair.parishId) continue;
        await linkApplicationParish(connection, pair.applicationId, pair.parishId, staff.id);
        linked++;
      }
      await audit(connection, staffActor(staff), 'parish_review.matches_confirmed', null, { linked, skipped: pairs.length - linked });
      return { linked, skipped: pairs.length - linked };
    });
    return { ok: true, ...result };
  });
}
