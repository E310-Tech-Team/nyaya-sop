alter table mentor_nominations add column pillar_fits text[];

update mentor_nominations
   set pillar_fits = array[pillar_fit]
 where pillar_fits is null;

alter table mentor_nominations
  add constraint mentor_nominations_pillar_fits_count
  check (pillar_fits is null or cardinality(pillar_fits) between 1 and 8);
