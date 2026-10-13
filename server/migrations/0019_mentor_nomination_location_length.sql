alter table mentor_nominations
  drop constraint mentor_nominations_region_location_check;

alter table mentor_nominations
  add constraint mentor_nominations_region_location_check
  check (char_length(region_location) between 2 and 300);
