-- School of Purpose: expression-of-interest schema.
-- Applied by server/migrate.ts inside a transaction; do not add BEGIN/COMMIT here.
-- Enum values must match src/shared/application.ts.

create type gender as enum ('male', 'female', 'prefer_not_to_say');
create type age_range as enum ('18_20', '21_24', '25_27', '28_30');
create type education_level as enum ('secondary_school', 'ond_nce', 'hnd', 'bachelors', 'masters');
create type current_status as enum (
  'student', 'nysc', 'employed', 'entrepreneur', 'freelancer', 'job_seeker', 'recent_graduate', 'other'
);
-- Review workflow states; only 'submitted' is set by the app today.
create type application_status as enum (
  'submitted', 'under_review', 'shortlisted', 'invited', 'not_selected', 'withdrawn'
);

create table cohorts (
  id                         uuid primary key default gen_random_uuid(),
  slug                       text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name                       text not null,
  edition                    smallint not null check (edition > 0),
  applications_open_at       timestamptz,
  applications_close_at      timestamptz,
  is_accepting_applications  boolean not null default false,
  created_at                 timestamptz not null default now(),
  check (applications_close_at is null or applications_open_at is null
         or applications_close_at > applications_open_at)
);

-- Exact wording of each consent statement shown to applicants, for audit.
create table consent_versions (
  version     text primary key,
  statement   text not null,
  created_at  timestamptz not null default now()
);

create table applications (
  id                  uuid primary key default gen_random_uuid(),
  cohort_id           uuid not null references cohorts (id),
  status              application_status not null default 'submitted',
  full_name           text not null check (char_length(full_name) between 2 and 120),
  email               text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  phone_e164          text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  gender              gender not null,
  age_range           age_range not null,
  state_of_residence  text not null check (char_length(state_of_residence) between 2 and 60),
  city                text not null check (char_length(city) between 2 and 80),
  parish_name         text check (parish_name is null or char_length(parish_name) between 1 and 120),
  education_level     education_level not null,
  current_status      current_status not null,
  purpose_clarity     smallint not null check (purpose_clarity between 1 and 5),
  consent_version     text not null references consent_versions (version),
  consent_at          timestamptz not null default now(),
  -- UTM tags + referring site (no IP addresses are stored).
  submission_meta     jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  -- One expression of interest per email address per cohort.
  constraint applications_cohort_email_key unique (cohort_id, email)
);

create index applications_cohort_created_idx on applications (cohort_id, created_at desc);
create index applications_cohort_status_idx on applications (cohort_id, status);
