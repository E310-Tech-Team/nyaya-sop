-- Review workflow. `status` (0001) is the internal review state; applicants only ever see
-- `published_status` and `published_message`, set by an explicit publication.

alter table applications
  add column assigned_reviewer_id  uuid references staff_users (id) on delete set null,
  add column status_changed_at     timestamptz,
  add column published_status      application_status not null default 'submitted',
  add column published_message     text check (published_message is null or char_length(published_message) between 1 and 1000),
  add column published_at          timestamptz,
  add column published_by          uuid references staff_users (id) on delete set null;
create index applications_reviewer_idx on applications (assigned_reviewer_id) where assigned_reviewer_id is not null;

-- Internal notes: staff only, never returned by any applicant endpoint.
create table application_notes (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications (id) on delete cascade,
  author_id       uuid references staff_users (id) on delete set null,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now()
);
create index application_notes_application_idx on application_notes (application_id, created_at);

-- Every review-status change and every publication, in order.
create table application_status_events (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references applications (id) on delete cascade,
  kind            text not null check (kind in ('review', 'publication')),
  from_status     application_status,
  to_status       application_status not null,
  actor_id        uuid references staff_users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index application_status_events_application_idx on application_status_events (application_id, created_at);
