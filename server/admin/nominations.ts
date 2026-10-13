/**
 * Mentor nominations for staff (docs/05 §6, docs/06 20.4, D-62): the list with search and filters,
 * one nomination in full, a CSV download and deletion (for a request to remove someone's details).
 * The public form only ever writes (POST /api/mentor-nominations); nothing here is public. Opening,
 * downloading and deleting are audited with identifiers and filter names only.
 */
import type { FastifyInstance } from 'fastify';
import { formatPhone, labelFor } from '../../src/shared/application';
import {
  RCCG_STATUSES,
  STORED_MENTOR_AGE_RANGES,
  labelsForPillarFits,
  type StoredMentorAgeRange,
  type RccgStatus,
} from '../../src/shared/mentor-nomination';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import { staffActor } from '../auth/staff-routes';
import { formatTime, toCsv } from '../csv';
import { iso, isUuid, paging, sendError, str } from '../http';
import type { Services } from '../services';

type Filters = { q?: string; age?: string; rccg?: string; page?: string; pageSize?: string };
const FILTER_KEYS = ['q', 'age', 'rccg'] as const;

type NominationRow = {
  id: string;
  created_at: Date;
  nominator_name: string;
  nominee_name: string;
  nominee_state: string | null;
  region_location: string;
  church_denomination: string | null;
  nominee_phone_e164: string;
  nominee_email: string;
  nominee_age_range: StoredMentorAgeRange;
  job_role: string;
  experience: string;
  pillar_fit: string;
  pillar_fits: string[] | null;
  nominee_rccg_status: RccgStatus;
  why_fit: string;
  testimonial: string;
  social_profile: string | null;
};

const isAgeRange = (value: unknown): value is StoredMentorAgeRange => STORED_MENTOR_AGE_RANGES.some((option) => option.value === value);
const isRccgStatus = (value: unknown): value is RccgStatus => RCCG_STATUSES.some((option) => option.value === value);

/**
 * The filters as SQL: the words typed (in the nominee's name, email, state, location, denomination,
 * role or pillar fit, or the nominator's name), an age range and an RCCG status. Unknown values are ignored.
 */
function whereFor(query: Filters) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const q = typeof query.q === 'string' ? query.q.trim().toLowerCase().slice(0, 100) : '';
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}::text`;
    conditions.push(
      `(lower(n.nominee_name) like ${p} or n.nominee_email like ${p} or lower(coalesce(n.nominee_state, '')) like ${p}
      or lower(n.region_location) like ${p} or lower(coalesce(n.church_denomination, '')) like ${p}
      or lower(n.job_role) like ${p} or lower(coalesce(array_to_string(n.pillar_fits, ' '), n.pillar_fit)) like ${p}
      or lower(n.nominator_name) like ${p})`,
    );
  }
  if (isAgeRange(query.age)) {
    params.push(query.age);
    conditions.push(`n.nominee_age_range = $${params.length}::mentor_nominee_age_range`);
  }
  if (isRccgStatus(query.rccg)) {
    params.push(query.rccg);
    conditions.push(`n.nominee_rccg_status = $${params.length}::mentor_nominee_rccg_status`);
  }
  return { where: conditions.length ? `where ${conditions.join(' and ')}` : '', params };
}

const COLUMNS = `n.id, n.created_at, n.nominator_name, n.nominee_name, n.nominee_state, n.region_location, n.church_denomination,
  n.nominee_phone_e164, n.nominee_email,
  n.nominee_age_range::text as nominee_age_range, n.job_role, n.experience, n.pillar_fit, n.pillar_fits,
  n.nominee_rccg_status::text as nominee_rccg_status, n.why_fit, n.testimonial, n.social_profile`;

const summary = (row: NominationRow) => ({
  id: row.id,
  submittedAt: iso(row.created_at),
  nomineeName: row.nominee_name,
  nomineeState: row.nominee_state,
  nomineeEmail: row.nominee_email,
  nomineePhone: formatPhone(row.nominee_phone_e164),
  regionLocation: row.region_location,
  churchDenomination: row.church_denomination,
  jobRole: row.job_role,
  pillarFits: labelsForPillarFits(row.pillar_fits ?? [row.pillar_fit]),
  ageRange: row.nominee_age_range,
  rccgStatus: row.nominee_rccg_status,
  nominatorName: row.nominator_name,
});

export async function nominationRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const view = staffGuard(services, { permission: 'nominations.view' });

  app.get<{ Querystring: Filters }>('/', { preHandler: view }, async (request) => {
    const { page, pageSize, offset } = paging(request.query, 50);
    const { where, params } = whereFor(request.query);
    const { rows } = await db.query<NominationRow & { total: number }>(
      `select ${COLUMNS}, count(*) over ()::int as total
         from mentor_nominations n ${where}
        order by n.created_at desc, n.id limit ${pageSize} offset ${offset}`,
      params,
    );
    const { rows: all } = await db.query<{ n: number }>('select count(*)::int as n from mentor_nominations');
    return { page, pageSize, total: rows[0]?.total ?? 0, all: all[0]?.n ?? 0, items: rows.map(summary) };
  });

  app.get<{ Querystring: Filters }>(
    '/export.csv',
    { preHandler: staffGuard(services, { permission: 'nominations.export' }), config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const { where, params } = whereFor(request.query);
      const { rows } = await db.query<NominationRow>(`select ${COLUMNS} from mentor_nominations n ${where} order by n.created_at`, params);
      await audit(db, staffActor(request.staff!), 'nominations.exported', null, {
        rows: rows.length,
        filters: FILTER_KEYS.filter((key) => (request.query as Record<string, unknown>)[key]),
      });
      const csv = toCsv(
        [
          'Submitted (WAT)',
          'Nominee',
          'Nominee email',
          'Nominee phone',
          'Nominee state of residence',
          'Age range',
          'Job role / profession',
          'RCCG province / base / location',
          'Church denomination',
          'RCCG status',
          'Pillar fit',
          'Experience',
          'Why a good fit',
          'Testimonial',
          'Social media profile',
          'Nominated by',
          'Reference',
        ],
        rows.map((row) => [
          formatTime(row.created_at),
          row.nominee_name,
          row.nominee_email,
          formatPhone(row.nominee_phone_e164),
          row.nominee_state,
          labelFor(STORED_MENTOR_AGE_RANGES, row.nominee_age_range),
          row.job_role,
          row.region_location,
          row.church_denomination,
          labelFor(RCCG_STATUSES, row.nominee_rccg_status),
          labelsForPillarFits(row.pillar_fits ?? [row.pillar_fit]).join(', '),
          row.experience,
          row.why_fit,
          row.testimonial,
          row.social_profile,
          row.nominator_name,
          row.id,
        ]),
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="sop-mentor-nominations-${new Date().toISOString().slice(0, 10)}.csv"`)
        .header('cache-control', 'no-store')
        .send(`﻿${csv}`);
    },
  );

  app.get<{ Params: { id: string } }>('/:id', { preHandler: view }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Nomination not found.');
    const { rows } = await db.query<NominationRow>(`select ${COLUMNS} from mentor_nominations n where n.id = $1`, [request.params.id]);
    const row = rows[0];
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Nomination not found.');
    await audit(db, staffActor(request.staff!), 'nomination.viewed', { type: 'nomination', id: row.id });
    return {
      ...summary(row),
      nomineePhoneE164: row.nominee_phone_e164,
      nomineeState: row.nominee_state,
      churchDenomination: row.church_denomination,
      experience: row.experience,
      whyFit: row.why_fit,
      testimonial: row.testimonial,
      socialProfile: row.social_profile,
    };
  });

  /** For a request to remove someone's details. Needs the nominee's email address typed back. */
  app.post<{ Params: { id: string } }>('/:id/delete', { preHandler: staffGuard(services, { permission: 'nominations.manage' }) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Nomination not found.');
    const { rows } = await db.query<{ nominee_email: string }>('select nominee_email from mentor_nominations where id = $1', [request.params.id]);
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Nomination not found.');
    if (str(request.body, 'confirm', 254)?.toLowerCase() !== rows[0].nominee_email) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Type the nominee’s email address to confirm.');
    }
    await db.query('delete from mentor_nominations where id = $1', [request.params.id]);
    await audit(db, staffActor(request.staff!), 'nomination.deleted', { type: 'nomination', id: request.params.id });
    return { ok: true };
  });
}
