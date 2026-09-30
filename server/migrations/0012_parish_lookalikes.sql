-- Same-named parishes in one unit ("look-alikes", docs/05 §2, docs/06 D-55). The RCCG directory
-- API lists 1,500 groups of parishes that share a name within one province, region or continent,
-- each with its own canonical code but nothing an applicant could tell apart. The form offers
-- each group once; the application links to the group's first parish (by code) so province,
-- region and continent counts are right, keeps the whole group in its snapshot, and raises a
-- "which parish?" report for staff, who link the right one in Parish review.
--
-- Numbered 0012: 0011 belongs to another branch (the gender options). Migrations apply in
-- filename order, whichever are pending, so either can be merged first.

alter type parish_report_kind add value if not exists 'lookalike';

-- A report names a parish for "details look wrong" and now for "which parish?" too. The kind is
-- compared as text: a value added to an enum can't be used as one in the transaction that adds it.
do $$
declare
  existing text;
begin
  select conname into existing from pg_constraint
   where conrelid = 'parish_reports'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%details_wrong%';
  if existing is not null then
    execute format('alter table parish_reports drop constraint %I', existing);
  end if;
end $$;
alter table parish_reports add constraint parish_reports_parish_check
  check ((kind::text in ('details_wrong', 'lookalike')) = (parish_id is not null));

-- Finding a parish's look-alikes: the active parishes with its unit and name key.
create index parishes_lookalike_idx on parishes (unit_id, name_key) where status = 'active';
