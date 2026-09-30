import type { NormalizedApplication, StoredGender } from '../src/shared/application';
import type { Queryable } from './db';
import type { ParishLink } from './parishes';

export type CohortRow = {
  id: string;
  slug: string;
  name: string;
  edition: number;
  applications_close_at: Date | null;
  is_open: boolean;
};

/**
 * The cohort the site is currently about: an open one if there is one, otherwise the
 * latest edition (so the UI can say "applications are closed").
 */
export async function getCurrentCohort(db: Queryable): Promise<CohortRow | null> {
  const { rows } = await db.query<CohortRow>(
    `select id, slug, name, edition, applications_close_at,
            (is_accepting_applications
              and (applications_open_at is null or applications_open_at <= now())
              and (applications_close_at is null or applications_close_at > now())) as is_open
       from cohorts
      order by is_open desc, edition desc, created_at desc
      limit 1`,
  );
  return rows[0] ?? null;
}

/**
 * Inserts an application, with its parish link and any parish report (resolveParish in
 * server/parishes.ts), in one statement. Returns null when this email already applied to the cohort.
 */
export async function insertApplication(
  db: Queryable,
  cohortId: string,
  application: NormalizedApplication,
  parish: ParishLink,
): Promise<{ id: string; created_at: Date } | null> {
  const { rows } = await db.query<{ id: string; created_at: Date }>(
    `with inserted as (
       insert into applications (
         cohort_id, full_name, email, phone_e164, gender, age_range, state_of_residence, city,
         parish_name, parish_id, parish_status, parish_snapshot,
         education_level, current_status, purpose_clarity, consent_version, submission_meta
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       on conflict (cohort_id, email) do nothing
       returning id, created_at
     ),
     reports as (
       insert into parish_reports (application_id, kind, reported_name, parish_id)
       select i.id, r.kind::parish_report_kind, r.reported_name, r.parish_id
         from inserted i cross join jsonb_to_recordset($18::jsonb) as r(kind text, reported_name text, parish_id uuid)
       returning 1
     )
     select id, created_at from inserted`,
    [
      cohortId,
      application.fullName,
      application.email,
      application.phoneE164,
      application.gender,
      application.ageRange,
      application.stateOfResidence,
      application.city,
      parish.name,
      parish.parishId,
      parish.status,
      parish.snapshot ? JSON.stringify(parish.snapshot) : null,
      application.educationLevel,
      application.currentStatus,
      application.purposeClarity,
      application.consentVersion,
      JSON.stringify(application.meta),
      // Rows as one JSON parameter (PGlite doesn't serialise arrays of custom enum types).
      JSON.stringify(
        parish.reports.map((report) =>
          report.kind === 'not_listed'
            ? { kind: report.kind, reported_name: report.name, parish_id: null }
            : { kind: report.kind, reported_name: null, parish_id: report.parishId },
        ),
      ),
    ],
  );
  return rows[0] ?? null;
}

export type ApplicationExportRow = {
  id: string;
  created_at: Date;
  cohort_slug: string;
  status: string;
  published_status?: string;
  full_name: string;
  email: string;
  phone_e164: string;
  /** Can be an answer the form no longer offers ("prefer_not_to_say", before 2026-09-30). */
  gender: StoredGender;
  age_range: string;
  state_of_residence: string;
  city: string;
  parish_name: string | null;
  education_level: string;
  current_status: string;
  purpose_clarity: number;
  consent_version: string;
  consent_at: Date;
  submission_meta: Record<string, string>;
  /** How the parish question was answered, and the linked parish in today's directory. */
  parish_status?: string;
  directory_parish?: string | null;
  province?: string | null;
  region?: string | null;
  continent?: string | null;
};
