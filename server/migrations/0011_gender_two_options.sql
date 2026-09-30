-- Gender has two options from 2026-09-30: male and female (docs/06 D-54). "Prefer not to say" is
-- no longer offered, and the shared validation refuses it (src/shared/validation.ts).
--
-- Applications saved with it keep it: the `gender` enum keeps the value, and existing rows are
-- neither changed nor reclassified (those applicants chose neither male nor female). From now on
-- no new row, and no change to a row's gender, can use it.
--
-- A trigger, not a CHECK constraint: Postgres checks every CHECK against each new version of a row,
-- so even one added NOT VALID (which only skips the rows already there) would make every later
-- update of an earlier row fail: a review status change, a publication, a staff correction, a
-- parish link, or the ON DELETE SET NULL update when a linked staff member or applicant account
-- is deleted. The trigger fires only on inserts and on updates that set `gender`, and lets an
-- update keep the value already stored.
--
-- Numbered 0011 because another branch adds 0010_directory_api.sql: migrations apply in filename
-- order, whichever are pending, so either branch can be merged first.

create function applications_gender_offered() returns trigger
  language plpgsql
as $$
begin
  if new.gender in ('male', 'female') then
    return new;
  end if;
  -- An earlier answer staying as it was ("set gender = gender").
  if tg_op = 'UPDATE' then
    if new.gender = old.gender then
      return new;
    end if;
  end if;
  -- No value in the message: server logs keep an error's message (errorForLog in server/app.ts).
  raise exception 'applications.gender: new answers must be male or female'
    using errcode = 'check_violation';
end;
$$;

comment on function applications_gender_offered() is
  'Only male or female for new applications and changed answers; rows saved with prefer_not_to_say keep it (migration 0011).';

create trigger applications_gender_offered
  before insert or update of gender on applications
  for each row execute function applications_gender_offered();
