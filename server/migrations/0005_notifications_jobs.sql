-- Web Push subscriptions and notification consent, announcements and the in-app inbox,
-- campaigns, the messages actually sent (frozen content) with per-device deliveries, and a
-- PostgreSQL-backed job queue.

create type push_subscription_status as enum ('active', 'expired', 'revoked');

-- One row per browser push subscription. The endpoint and keys are encrypted at rest; the
-- endpoint hash gives uniqueness and lookups, the auth-secret hash lets a browser prove it
-- owns the subscription (only that browser and this server know the secret).
create table push_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  endpoint_hash       text not null unique,
  endpoint_enc        text not null,
  keys_enc            text not null,
  auth_hash           text not null,
  push_host           text not null check (char_length(push_host) <= 253),
  -- A device belongs to at most one of: an applicant account, a staff member (test device).
  account_id          uuid references applicant_accounts (id) on delete set null,
  staff_id            uuid references staff_users (id) on delete cascade,
  topics              text[] not null default '{}'
                        check (topics <@ array['general', 'application', 'training']::text[]),
  status              push_subscription_status not null default 'active',
  device_label        text check (char_length(device_label) <= 60),
  expiration_time     timestamptz,
  consent_version     text not null check (char_length(consent_version) <= 40),
  consent_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  failure_count       integer not null default 0,
  deactivated_at      timestamptz,
  deactivated_reason  text check (deactivated_reason in ('unsubscribed', 'expired', 'rejected', 'account_deleted', 'account_suspended', 'replaced')),
  check (account_id is null or staff_id is null),
  -- Application and training topics need a verified account; staff test devices take no topics.
  check (account_id is not null or not (topics && array['application', 'training']::text[])),
  check (staff_id is null or topics = '{}'),
  check ((status = 'active') = (deactivated_at is null))
);
create index push_subscriptions_account_idx on push_subscriptions (account_id) where account_id is not null;
create index push_subscriptions_staff_idx on push_subscriptions (staff_id) where staff_id is not null;
create index push_subscriptions_active_topics_idx on push_subscriptions using gin (topics) where status = 'active';

-- Notification consent history (separate from the application's contact consent).
create table notification_consent_events (
  id               bigint generated always as identity primary key,
  subscription_id  uuid references push_subscriptions (id) on delete set null,
  account_id       uuid references applicant_accounts (id) on delete set null,
  action           text not null check (action in ('opt_in', 'update', 'opt_out', 'expired', 'linked', 'unlinked')),
  topics           text[] not null,
  consent_version  text not null,
  created_at       timestamptz not null default now()
);
create index notification_consent_events_subscription_idx on notification_consent_events (subscription_id, created_at);

create type announcement_audience as enum ('public', 'applicants');
create type announcement_status as enum ('draft', 'published', 'archived');

create table announcements (
  id            uuid primary key default gen_random_uuid(),
  audience      announcement_audience not null,
  -- Applicant notices may be limited to one cohort's applicants.
  cohort_id     uuid references cohorts (id),
  title         text not null check (char_length(title) between 1 and 120),
  body          text not null check (char_length(body) between 1 and 5000),
  status        announcement_status not null default 'draft',
  published_at  timestamptz,
  created_by    uuid references staff_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (audience = 'applicants' or cohort_id is null),
  check ((status = 'draft') = (published_at is null))
);
create index announcements_published_idx on announcements (audience, published_at desc) where status = 'published';

create type campaign_status as enum ('draft', 'scheduled', 'sending', 'sent', 'cancelled');

-- What staff edit. Content is frozen (frozen_at) as soon as it is scheduled or sent.
create table campaigns (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique check (char_length(idempotency_key) between 8 and 80),
  title            text not null check (char_length(title) between 1 and 65),
  body             text not null check (char_length(body) between 1 and 180),
  link_path        text not null check (link_path ~ '^/[a-z0-9/_-]*$' and link_path !~ '//'),
  topic            text not null check (topic in ('general', 'application', 'training')),
  -- { cohortIds: uuid[], publishedStatuses: application_status[] } (empty = no filter)
  audience         jsonb not null default '{}'::jsonb,
  also_inbox       boolean not null default true,
  ttl_seconds      integer not null default 86400 check (ttl_seconds between 300 and 2419200),
  status           campaign_status not null default 'draft',
  scheduled_for    timestamptz,
  time_zone        text not null default 'Africa/Lagos' check (char_length(time_zone) <= 64),
  frozen_at        timestamptz,
  created_by       uuid references staff_users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  scheduled_by     uuid references staff_users (id) on delete set null,
  dispatched_at    timestamptz,
  completed_at     timestamptz,
  cancelled_by     uuid references staff_users (id) on delete set null,
  cancelled_at     timestamptz,
  check (status = 'draft' or frozen_at is not null),
  check (status <> 'scheduled' or scheduled_for is not null),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index campaigns_status_scheduled_idx on campaigns (status, scheduled_for);

-- The frozen content actually sent: a dispatched campaign, a published application
-- update, or a staff test send.
create table notification_messages (
  id           uuid primary key default gen_random_uuid(),
  origin       text not null check (origin in ('campaign', 'application_update', 'test')),
  campaign_id  uuid references campaigns (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 65),
  body         text not null check (char_length(body) between 1 and 180),
  link_path    text not null check (link_path ~ '^/[a-z0-9/_-]*$' and link_path !~ '//'),
  topic        text not null check (topic in ('general', 'application', 'training', 'test')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  created_by   uuid references staff_users (id) on delete set null,
  check (origin <> 'campaign' or campaign_id is not null)
);
create unique index notification_messages_campaign_key on notification_messages (campaign_id) where origin = 'campaign';

create type delivery_status as enum ('queued', 'accepted', 'failed', 'expired', 'skipped');

-- One row per message per device: the unique key stops a message being queued twice for
-- the same device. "accepted" means the push service accepted it, not that it was shown.
create table notification_deliveries (
  id                uuid primary key default gen_random_uuid(),
  message_id        uuid not null references notification_messages (id) on delete cascade,
  subscription_id   uuid not null references push_subscriptions (id) on delete cascade,
  account_id        uuid references applicant_accounts (id) on delete set null,
  status            delivery_status not null default 'queued',
  attempts          integer not null default 0,
  last_http_status  integer,
  last_error        text check (char_length(last_error) <= 60),
  accepted_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (message_id, subscription_id)
);
create index notification_deliveries_message_status_idx on notification_deliveries (message_id, status);

-- Durable in-app inbox, so push is only an optional alert.
create table inbox_items (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references applicant_accounts (id) on delete cascade,
  kind            text not null check (kind in ('application_update', 'message')),
  title           text not null check (char_length(title) between 1 and 120),
  body            text not null check (char_length(body) between 1 and 1000),
  link_path       text check (link_path ~ '^/[a-z0-9/_-]*$' and link_path !~ '//'),
  message_id      uuid references notification_messages (id) on delete set null,
  application_id  uuid references applications (id) on delete cascade,
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);
create index inbox_items_account_idx on inbox_items (account_id, created_at desc);
create unique index inbox_items_message_account_key on inbox_items (message_id, account_id) where message_id is not null;

create type job_status as enum ('pending', 'running', 'succeeded', 'failed', 'cancelled');

-- Durable jobs. Claimed atomically with FOR UPDATE SKIP LOCKED under a lease; a job whose
-- lease expires (worker crashed or restarted) is claimed again. dedupe_key makes enqueueing
-- idempotent.
create table jobs (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind ~ '^[a-z_]+\.[a-z_]+$'),
  payload       jsonb not null default '{}'::jsonb,
  status        job_status not null default 'pending',
  run_at        timestamptz not null default now(),
  attempts      integer not null default 0,
  max_attempts  integer not null default 6 check (max_attempts between 1 and 50),
  locked_by     text,
  locked_until  timestamptz,
  last_error    text check (char_length(last_error) <= 300),
  dedupe_key    text unique check (char_length(dedupe_key) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index jobs_pending_idx on jobs (run_at) where status = 'pending';
create index jobs_running_idx on jobs (locked_until) where status = 'running';
create index jobs_status_updated_idx on jobs (status, updated_at);
