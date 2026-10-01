-- More ways through staff two-step verification (docs/05 §3, docs/06 D-58): passkeys, as the step
-- after the password or on their own, and one-time codes sent by email, beside the authenticator
-- app and recovery codes. "Two-step verification is on" (staff_users.mfa_enabled_at) now means the
-- account has at least one method: a passkey, the authenticator app or email codes.
--
-- Additive, so the release before this one still runs on it. That release looks only for an
-- authenticator secret: an account with no secret but a passkey or email codes stays "on" for it
-- and can't finish signing in there (it refuses rather than letting a password alone through).
-- Its owner reset still works: it clears mfa_enabled_at and the secret, which the new rule allows.

alter table staff_users
  -- The passkeys' user handle: random, never the email address or the account's id.
  add column webauthn_user_id       text unique,
  -- Email codes are one of this account's methods (the owner's decision: allowed on their own).
  add column email_codes_enabled_at timestamptz;

-- The old rule tied "on" to the authenticator secret. A secret still means it's on; a passkey or
-- email codes alone are now enough too (the application keeps mfa_enabled_at in step with them).
do $$
declare
  existing text;
begin
  select conname into existing from pg_constraint
   where conrelid = 'staff_users'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%mfa_enabled_at%' and pg_get_constraintdef(oid) like '%mfa_secret_enc%';
  if existing is not null then
    execute format('alter table staff_users drop constraint %I', existing);
  end if;
end $$;
alter table staff_users add constraint staff_users_mfa_secret_on_check check (mfa_secret_enc is null or mfa_enabled_at is not null);

create table staff_passkeys (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references staff_users (id) on delete cascade,
  credential_id  text not null unique,            -- base64url, as the browser reports it
  public_key     bytea not null,                  -- COSE key, as the authenticator gave it
  counter        bigint not null default 0,       -- signature counter (a step back suggests a cloned key)
  transports     text[] not null default '{}',
  aaguid         text,
  device_type    text not null check (device_type in ('singleDevice', 'multiDevice')),
  backed_up      boolean not null default false,  -- the authenticator says it's backed up (synced)
  nickname       text not null check (char_length(nickname) between 1 and 60),
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);
create index staff_passkeys_staff_idx on staff_passkeys (staff_id, created_at);

-- Single-use passkey challenges, each bound to what asked for it: the session that is signing in,
-- checking before a security change or registering a passkey; a password-reset link; or nothing
-- yet, when signing in with a passkey alone (that one names no account until the passkey does).
create type staff_challenge_purpose as enum ('sign_in', 'second_step', 'step_up', 'register', 'password_reset');
create table staff_passkey_challenges (
  id          uuid primary key default gen_random_uuid(),
  purpose     staff_challenge_purpose not null,
  challenge   text not null unique,
  staff_id    uuid references staff_users (id) on delete cascade,
  session_id  uuid references staff_sessions (id) on delete cascade,
  token_id    uuid references auth_tokens (id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  check ((purpose = 'sign_in') = (staff_id is null)),
  check ((purpose in ('second_step', 'step_up', 'register')) = (session_id is not null)),
  check ((purpose = 'password_reset') = (token_id is not null))
);
create index staff_passkey_challenges_expires_idx on staff_passkey_challenges (expires_at);

-- Email codes: only an HMAC of each code (under a key derived from APP_SECRET), tied to the staff
-- member, the session that asked and what for. Only the newest works.
create type staff_email_code_purpose as enum ('second_step', 'step_up', 'enable');
create table staff_email_codes (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references staff_users (id) on delete cascade,
  session_id  uuid not null references staff_sessions (id) on delete cascade,
  purpose     staff_email_code_purpose not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index staff_email_codes_staff_idx on staff_email_codes (staff_id, created_at desc);

alter table staff_sessions
  -- How this session passed its second step.
  add column mfa_method text check (mfa_method in ('passkey', 'totp', 'recovery', 'email')),
  -- When it last passed a check strong enough for security changes (adding or removing a method,
  -- new recovery codes): a passkey, the app or a recovery code, or an email code on an account
  -- whose only method is email codes. Changes need one from the last few minutes.
  add column step_up_at timestamptz;
