-- The RCCG directory API (the "RCCG Organisation Hierarchy API") as the directory's source
-- (docs/05 §2, "Directory API"). Its entries are identified by the provider's canonical code and
-- org-unit UUID under a namespace, rccg-org:production or rccg-org:sandbox: never by name, and
-- never mixed between the two environments (their codes differ). Rows from the spreadsheet keep
-- their name-based identity; once the API is in use they no longer supply suggestions (the
-- handover marks them inactive and reports how applications linked to them might map, for staff).

-- Name-based uniqueness is how spreadsheet imports recognise entries. API entries may share names
-- (two parishes of one name in a province are two parishes there) and are recognised by their IDs.
drop index church_units_named_idx;
create unique index church_units_named_idx on church_units (level, name_key)
  where level in ('continent', 'region', 'province') and external_id is null;
drop index church_units_local_idx;
create unique index church_units_local_idx on church_units (parent_id, level, name_key)
  where level in ('zone', 'area') and external_id is null;
alter table parishes drop constraint parishes_unit_id_name_key_key;
create unique index parishes_unit_name_idx on parishes (unit_id, name_key) where external_id is null;

-- external_id holds "<namespace>:<canonical code>"; external_uuid the provider's org-unit UUID,
-- which its change feed uses to link parents. All three are set together, or none.
alter table church_units
  add column external_namespace text check (external_namespace in ('rccg-org:production', 'rccg-org:sandbox')),
  add column external_uuid uuid,
  add constraint church_units_external_check
    check ((external_namespace is null) = (external_id is null) and (external_namespace is null) = (external_uuid is null));
alter table parishes
  add column external_namespace text check (external_namespace in ('rccg-org:production', 'rccg-org:sandbox')),
  add column external_uuid uuid,
  add constraint parishes_external_check
    check ((external_namespace is null) = (external_id is null) and (external_namespace is null) = (external_uuid is null));
create unique index church_units_external_uuid_idx on church_units (external_namespace, external_uuid) where external_uuid is not null;
create unique index parishes_external_uuid_idx on parishes (external_namespace, external_uuid) where external_uuid is not null;

-- Where each environment's sync stands: the release applied, when the provider last confirmed it
-- is the latest (freshness), and the last failure as a short code (never a payload or a key).
create table directory_sync (
  namespace        text primary key check (namespace in ('rccg-org:production', 'rccg-org:sandbox')),
  release_version  text check (char_length(release_version) between 1 and 50),
  release_id       uuid,
  release_name     text check (char_length(release_name) <= 200),
  effective_from   timestamptz,
  checked_at       timestamptz,
  synced_at        timestamptz,
  import_id        uuid references directory_imports (id) on delete set null,
  last_error       text check (last_error ~ '^[a-z]+(_[a-z]+)*$' and char_length(last_error) <= 40),
  last_error_at    timestamptz,
  failures         integer not null default 0 check (failures >= 0),
  updated_at       timestamptz not null default now()
);

-- Releases are immutable (the contract says so and invites caching them), so each one's checked
-- change rows are kept: a new release fetches only its own changes, and the whole hierarchy is
-- rebuilt by replaying them from the base release. Directory names and IDs only, never applicant data.
create table directory_releases (
  namespace          text not null check (namespace in ('rccg-org:production', 'rccg-org:sandbox')),
  version_code       text not null check (char_length(version_code) between 1 and 50),
  release_id         uuid not null,
  base_version_code  text check (char_length(base_version_code) between 1 and 50),
  effective_from     timestamptz,
  counts             jsonb not null default '{}',
  fetched_at         timestamptz not null default now(),
  primary key (namespace, version_code)
);
create table directory_release_changes (
  namespace     text not null,
  version_code  text not null,
  seq           integer not null check (seq >= 0),
  change        jsonb not null,
  primary key (namespace, version_code, seq),
  foreign key (namespace, version_code) references directory_releases (namespace, version_code) on delete cascade
);

-- The handover's report: each spreadsheet parish that applications link to, and the API parishes
-- with exactly the same name and chain. Nothing is relinked automatically: staff decide.
create type legacy_match_status as enum ('matched', 'ambiguous', 'unmatched');
create table directory_legacy_matches (
  legacy_parish_id  uuid primary key references parishes (id) on delete cascade,
  namespace         text not null check (namespace in ('rccg-org:production', 'rccg-org:sandbox')),
  status            legacy_match_status not null,
  candidate_ids     uuid[] not null default '{}',
  applications      integer not null default 0 check (applications >= 0),
  checked_at        timestamptz not null default now(),
  check ((status = 'unmatched') = (cardinality(candidate_ids) = 0)),
  check (status <> 'matched' or cardinality(candidate_ids) = 1)
);
