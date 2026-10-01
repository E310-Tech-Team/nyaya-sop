-- The parish question in two steps (docs/05 §2, docs/06 D-59): an applicant chooses their province
-- (or the region or continent some parishes sit directly under), then a parish in it. One who
-- can't find their parish there says so with that province chosen. It is kept here, as the
-- directory named it then: { unit: { id, name, level }, importId, externalId, continent, region,
-- province, zone, area }, from the directory, never from the browser. Like parish_snapshot, it is
-- the applicant's answer and never changes; Parish review uses it to suggest and add the parish.
--
-- A column of its own, not parish_snapshot: the release before this one reads every snapshot as a
-- chosen parish, so it keeps working on this database, rows written by this release included.

alter table applications add column parish_place_snapshot jsonb;
alter table applications add constraint applications_parish_place_check
  check (parish_place_snapshot is null or (parish_status = 'reported' and jsonb_typeof(parish_place_snapshot) = 'object'));
