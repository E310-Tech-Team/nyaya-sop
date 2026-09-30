-- Parish administration (docs/05 §2, "Parish directory"): corrections staff make to imported
-- entries, which later imports keep; parishes staff link to applications; and earlier free-text
-- answers staff have looked at in Parish review.

-- The fields staff corrected: 'display_name', 'parent' and 'state' on units; 'display_name',
-- 'unit_id' and 'status' on parishes. An import keeps these as staff set them and lists where
-- the source differs (server/directory/plan.ts).
alter table church_units add column staff_fields text[] not null default '{}';
alter table parishes add column staff_fields text[] not null default '{}';
-- For a parish staff moved: the unit the source lists it under, so imports still recognise it.
alter table parishes add column source_unit_id uuid references church_units (id);

-- parish_id is the application's current parish: the one the applicant chose ('listed', with
-- the snapshot they confirmed) or one staff linked to a reported, typed or blank answer.
alter table applications drop constraint applications_parish_link_check;
alter table applications add constraint applications_parish_link_check check (parish_status <> 'listed' or parish_id is not null);
alter table applications
  add column parish_linked_by uuid references staff_users (id) on delete set null,
  add column parish_linked_at timestamptz,
  -- An earlier free-text answer staff checked and couldn't match to a parish: it leaves Parish review.
  add column parish_text_reviewed_at timestamptz;
create index applications_parish_text_idx on applications (created_at)
  where parish_status = 'legacy_text' and parish_id is null and parish_text_reviewed_at is null;
