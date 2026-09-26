-- Staff and applicant identities, sessions, single-use tokens, audit trail, settings and
-- minimal analytics. Applied by server/migrate.ts inside a transaction.
--
-- Secrets are never stored in the clear: session and link tokens are SHA-256 hashes,
-- passwords are scrypt hashes, TOTP secrets are AES-256-GCM encrypted with a key derived
-- from APP_SECRET (server/crypto.ts).

create type staff_role as enum ('owner', 'programme_admin', 'reviewer', 'communications', 'read_only');
create type staff_status as enum ('invited', 'active', 'suspended');

create table staff_users (
  id                     uuid primary key default gen_random_uuid(),
  email                  text not null unique check (char_length(email) between 3 and 254 and email = lower(email)),
  display_name           text not null check (char_length(display_name) between 1 and 80),
  role                   staff_role not null,
  status                 staff_status not null default 'invited',
  password_hash          text,
  password_changed_at    timestamptz,
  -- TOTP: confirmed secret, a secret awaiting confirmation, and the last accepted time step
  -- (a code is never accepted twice).
  mfa_secret_enc         text,
  mfa_pending_secret_enc text,
  mfa_enabled_at         timestamptz,
  mfa_last_step          bigint,
  failed_login_count     integer not null default 0,
  locked_until           timestamptz,
  invited_by             uuid references staff_users (id) on delete set null,
  created_at             timestamptz not null default now(),
  last_login_at          timestamptz,
  suspended_at           timestamptz,
  check (status = 'invited' or password_hash is not null),
  check ((mfa_enabled_at is null) = (mfa_secret_enc is null))
);

create table staff_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references staff_users (id) on delete cascade,
  code_hash   text not null unique,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index staff_recovery_codes_staff_idx on staff_recovery_codes (staff_id);

create table staff_sessions (
  id               uuid primary key default gen_random_uuid(),
  token_hash       text not null unique,
  staff_id         uuid not null references staff_users (id) on delete cascade,
  -- Set once the second factor has been checked in this session.
  mfa_verified_at  timestamptz,
  mfa_attempts     integer not null default 0,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  device_label     text check (char_length(device_label) <= 60)
);
create index staff_sessions_staff_idx on staff_sessions (staff_id) where revoked_at is null;

create type applicant_account_status as enum ('active', 'suspended');

-- An account exists only once its email address has been verified by a sign-in link.
create table applicant_accounts (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique check (char_length(email) between 3 and 254 and email = lower(email)),
  status             applicant_account_status not null default 'active',
  email_verified_at  timestamptz not null,
  created_at         timestamptz not null default now(),
  last_login_at      timestamptz,
  suspended_at       timestamptz,
  check ((status = 'suspended') = (suspended_at is not null))
);

create table applicant_sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  account_id    uuid not null references applicant_accounts (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  device_label  text check (char_length(device_label) <= 60)
);
create index applicant_sessions_account_idx on applicant_sessions (account_id) where revoked_at is null;

create type auth_token_purpose as enum ('applicant_sign_in', 'staff_invite', 'staff_password_reset');

-- Single-use, short-lived links. Only the hash is stored; used_at makes them single-use.
create table auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  purpose     auth_token_purpose not null,
  token_hash  text not null unique,
  email       text not null check (email = lower(email)),
  staff_id    uuid references staff_users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  check (purpose = 'applicant_sign_in' or staff_id is not null)
);
create index auth_tokens_email_created_idx on auth_tokens (email, purpose, created_at desc);

-- Applications can be claimed by the verified account with the same email address.
alter table applications
  add column account_id  uuid references applicant_accounts (id) on delete set null,
  add column claimed_at  timestamptz,
  add constraint applications_claim_consistent check ((account_id is null) = (claimed_at is null));
create index applications_account_idx on applications (account_id) where account_id is not null;
create index applications_email_idx on applications (email);

-- Who did what, for exports, decisions, account changes and campaign sends. `details` holds
-- identifiers and counts, never personal data or message bodies.
create table audit_events (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  actor_type   text not null check (actor_type in ('staff', 'applicant', 'system')),
  actor_id     uuid,
  action       text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type  text,
  target_id    text,
  details      jsonb not null default '{}'::jsonb
);
create index audit_events_created_idx on audit_events (created_at desc);
create index audit_events_target_idx on audit_events (target_type, target_id, created_at desc);
create index audit_events_actor_idx on audit_events (actor_id, created_at desc);

-- Operational settings editable by owners (never secrets: those stay in the environment).
create table app_settings (
  key         text primary key check (key ~ '^[a-z_]+$'),
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff_users (id) on delete set null
);

-- Minimal product analytics: an allowlisted event name and a few coarse properties
-- (display mode, platform family, campaign id). No identifiers, no IP addresses.
create table analytics_events (
  id          bigint generated always as identity primary key,
  name        text not null check (name in (
                'application_submitted', 'install_prompt_available', 'install_prompt_accepted',
                'install_prompt_dismissed', 'app_installed', 'standalone_launch',
                'push_opt_in', 'push_opt_out', 'notification_click')),
  properties  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index analytics_events_name_created_idx on analytics_events (name, created_at);
