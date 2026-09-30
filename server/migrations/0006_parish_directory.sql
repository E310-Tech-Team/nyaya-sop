-- The RCCG parish directory (docs/05 §2, "Parish directory"): continents, regions and provinces
-- (and zones and areas, once RCCG provides them) in one table of units, the parishes under
-- them, and the history of every import. Filled by `pnpm directory import` (server/directory/);
-- the source files never go in the repository. No applicant data here.

-- Stored from src/shared/directory.ts CHURCH_LEVELS; the order matters (a parent comes first).
create type church_level as enum ('continent', 'region', 'province', 'zone', 'area');
create type directory_status as enum ('active', 'inactive', 'merged');
-- 'staff' entries were added by hand; an import never deactivates them.
create type directory_origin as enum ('import', 'staff');
create type directory_source as enum ('spreadsheet', 'api');
-- 'planned' is for syncs that wait for staff review (the RCCG API, later).
create type directory_import_status as enum ('planned', 'applied', 'reverted', 'failed');

-- Each unit links only to the level above it, and (parent_id, parent_level) must name a real
-- unit at an earlier level: so a parish's province and region can never disagree.
create table church_units (
  id              uuid primary key default gen_random_uuid(),
  level           church_level not null,
  official_name   text not null check (char_length(official_name) between 1 and 200),
  display_name    text not null check (char_length(display_name) between 1 and 200),
  -- How imports recognise the unit (unitKey() in src/shared/directory.ts).
  name_key        text not null check (char_length(name_key) between 1 and 200),
  parent_id       uuid,
  parent_level    church_level,
  -- Provinces only: the state their name starts with, for ranking parish suggestions.
  state           text check (char_length(state) <= 60),
  -- The RCCG API's ID, once it is connected.
  external_id     text unique check (char_length(external_id) between 1 and 100),
  status          directory_status not null default 'active',
  merged_into_id  uuid references church_units (id),
  origin          directory_origin not null default 'import',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, level),
  foreign key (parent_id, parent_level) references church_units (id, level),
  check ((parent_id is null) = (parent_level is null)),
  check (parent_level < level),
  check (state is null or level = 'province'),
  check ((status = 'merged') = (merged_into_id is not null))
);
-- Continent, region and province names are unique across the church, so imports match them by
-- name; zone and area names repeat, so they are unique within their parent only.
create unique index church_units_named_idx on church_units (level, name_key) where level in ('continent', 'region', 'province');
create unique index church_units_local_idx on church_units (parent_id, level, name_key) where level in ('zone', 'area');
create index church_units_parent_idx on church_units (parent_id);

-- One row per parish entry. Rows the source lists more than once under the same unit and name
-- are one entry (listed_rows counts them). unit_id is the lowest level the source gives
-- (usually the province; the region or continent when there is none). The five chain columns
-- are a cache of the path up from unit_id, rebuilt in the same transaction as every change.
create table parishes (
  id              uuid primary key default gen_random_uuid(),
  unit_id         uuid not null references church_units (id),
  official_name   text not null check (char_length(official_name) between 1 and 200),
  display_name    text not null check (char_length(display_name) between 1 and 200),
  -- How imports recognise the parish within its unit (parishKey() in src/shared/directory.ts).
  name_key        text not null check (char_length(name_key) between 1 and 200),
  continent_id    uuid references church_units (id),
  region_id       uuid references church_units (id),
  province_id     uuid references church_units (id),
  zone_id         uuid references church_units (id),
  area_id         uuid references church_units (id),
  listed_rows     integer not null default 1 check (listed_rows between 1 and 1000),
  external_id     text unique check (char_length(external_id) between 1 and 100),
  status          directory_status not null default 'active',
  merged_into_id  uuid references parishes (id),
  origin          directory_origin not null default 'import',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (unit_id, name_key),
  check ((status = 'merged') = (merged_into_id is not null))
);
create index parishes_continent_idx on parishes (continent_id);
create index parishes_region_idx on parishes (region_id);
create index parishes_province_idx on parishes (province_id);
create index parishes_name_key_idx on parishes (name_key);

-- Every import or sync, applied or not. counts holds figures only.
create table directory_imports (
  id               uuid primary key default gen_random_uuid(),
  source           directory_source not null,
  source_label     text not null check (char_length(source_label) between 1 and 200),
  checksum         text check (char_length(checksum) <= 128),
  structure_as_at  date,
  status           directory_import_status not null,
  counts           jsonb not null default '{}',
  error            text check (char_length(error) <= 500),
  via              text not null check (via in ('cli', 'admin', 'sync')),
  staff_id         uuid references staff_users (id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  reverted_at      timestamptz,
  check ((status = 'reverted') = (reverted_at is not null))
);
create index directory_imports_started_idx on directory_imports (started_at desc);

-- Other spellings of a parish: variants merged at import, and earlier names.
create table parish_aliases (
  id          bigint generated always as identity primary key,
  parish_id   uuid not null references parishes (id) on delete cascade,
  alias       text not null check (char_length(alias) between 1 and 200),
  alias_key   text not null check (char_length(alias_key) between 1 and 200),
  import_id   uuid references directory_imports (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (parish_id, alias)
);
create index parish_aliases_key_idx on parish_aliases (alias_key);

-- Where new units came from ("Lagos Province 135 was created from Lagos Province 2, 23 …"), by
-- name, so it can be loaded before the new units exist. An import uses it to recognise a
-- parish that moved to a new province, so the parish keeps its ID and history.
create table unit_lineage (
  id            bigint generated always as identity primary key,
  level         church_level not null check (level in ('continent', 'region', 'province')),
  new_key       text not null check (char_length(new_key) between 1 and 200),
  new_name      text not null check (char_length(new_name) between 1 and 200),
  source_level  church_level not null check (source_level in ('continent', 'region', 'province')),
  source_key    text not null check (char_length(source_key) between 1 and 200),
  source_name   text not null check (char_length(source_name) between 1 and 200),
  approved_on   date,
  created_at    timestamptz not null default now(),
  unique (level, new_key, source_level, source_key)
);

-- What an import found: duplicates, parishes with no province, suspected moves. Directory
-- names only, never applicant data.
create table directory_issues (
  id         bigint generated always as identity primary key,
  import_id  uuid not null references directory_imports (id) on delete cascade,
  severity   text not null check (severity in ('info', 'warning', 'error')),
  code       text not null check (code ~ '^[a-z]+(_[a-z]+)*$'),
  line       integer check (line > 0),
  message    text not null check (char_length(message) <= 500),
  details    jsonb not null default '{}'
);
create index directory_issues_import_idx on directory_issues (import_id, severity, code);

-- Every change to a unit or parish, with the fields before and after, so an import can be
-- undone and each entry's history shown.
create table directory_changes (
  id          bigint generated always as identity primary key,
  import_id   uuid references directory_imports (id) on delete cascade,
  staff_id    uuid references staff_users (id) on delete set null,
  via         text not null check (via in ('import', 'staff')),
  entity      text not null check (entity in ('unit', 'parish')),
  entity_id   uuid not null,
  change      text not null check (change in ('create', 'update', 'move', 'reactivate', 'deactivate', 'merge')),
  before      jsonb,
  after       jsonb not null,
  created_at  timestamptz not null default now(),
  check ((via = 'import') = (import_id is not null)),
  check ((change = 'create') = (before is null))
);
create index directory_changes_import_idx on directory_changes (import_id, entity, change);
create index directory_changes_entity_idx on directory_changes (entity, entity_id, id);
