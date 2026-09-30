-- Links applications to the parish directory (docs/05 §2, "Parish directory"): the parish the
-- applicant confirmed, with a snapshot of what they saw; reports for a parish that isn't listed
-- or whose details look wrong; and the text the public parish search matches (trigram indexes).

-- Trusted since PostgreSQL 13: the database owner can create it. PGlite loads it in server/db.ts.
create extension if not exists pg_trgm;

-- The words parish search matches: the name key, other spellings, and the province and region
-- keys. Rebuilt with the chain cache in the same transaction as every change (server/directory/store.ts).
alter table parishes add column search_text text not null default '';
create index parishes_search_idx on parishes using gin (search_text gin_trgm_ops) where status = 'active';
create index parishes_name_trgm_idx on parishes using gin (name_key gin_trgm_ops) where status = 'active';

-- listed: chosen from the directory · reported: "I can't find my parish" (the name they typed) ·
-- legacy_text: the free-text question (before the directory, or an older copy of the form) ·
-- not_provided: left blank on the free-text question.
create type application_parish_status as enum ('listed', 'reported', 'legacy_text', 'not_provided');

alter table applications
  add column parish_id uuid references parishes (id),
  add column parish_status application_parish_status not null default 'not_provided',
  -- The parish and its province, region and continent as the applicant confirmed them (names and IDs).
  add column parish_snapshot jsonb,
  add constraint applications_parish_link_check check ((parish_status = 'listed') = (parish_id is not null)),
  add constraint applications_parish_snapshot_check check ((parish_status = 'listed') = (parish_snapshot is not null)),
  add constraint applications_parish_text_check check (parish_status not in ('reported', 'legacy_text') or parish_name is not null);
update applications set parish_status = 'legacy_text' where parish_name is not null;
create index applications_parish_idx on applications (parish_id) where parish_id is not null;

-- Directory names can be up to 200 characters; typed names stay limited to 120 by the form.
alter table applications drop constraint applications_parish_name_check;
alter table applications add constraint applications_parish_name_check
  check (parish_name is null or char_length(parish_name) between 1 and 200);

create type parish_report_kind as enum ('not_listed', 'details_wrong');
create type parish_report_status as enum ('pending', 'linked', 'added', 'fixed', 'rejected');

-- For staff to resolve in Parish review: a parish the applicant couldn't find (the name as they
-- typed it), or a listed parish whose province, region or continent looked wrong to them.
create table parish_reports (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null references applications (id) on delete cascade,
  kind                parish_report_kind not null,
  reported_name       text check (char_length(reported_name) between 2 and 120),
  parish_id           uuid references parishes (id),
  status              parish_report_status not null default 'pending',
  resolved_parish_id  uuid references parishes (id),
  resolved_by         uuid references staff_users (id) on delete set null,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (application_id, kind),
  check ((kind = 'not_listed') = (reported_name is not null)),
  check ((kind = 'details_wrong') = (parish_id is not null)),
  check ((status = 'pending') = (resolved_at is null))
);
create index parish_reports_pending_idx on parish_reports (created_at) where status = 'pending';
