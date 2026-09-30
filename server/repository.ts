import type { NormalizedApplication } from '../src/shared/application';
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
  const report = parish.report;
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
     report as (
       insert into parish_reports (application_id, kind, reported_name, parish_id)
       select id, $18::parish_report_kind, $19::text, $20::uuid from inserted where $18::parish_report_kind is not null
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
      report?.kind ?? null,
      report?.kind === 'not_listed' ? report.name : null,
      report?.kind === 'details_wrong' ? report.parishId : null,
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
  gender: string;
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
};
