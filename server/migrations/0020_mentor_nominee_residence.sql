alter table mentor_nominations
  add column nominee_state text,
  add column church_denomination text,
  drop constraint mentor_nominations_region_location_check;

alter table mentor_nominations
  add constraint mentor_nominations_nominee_state_check
    check (nominee_state is null or char_length(nominee_state) between 2 and 40),
  add constraint mentor_nominations_church_denomination_check
    check (church_denomination is null or char_length(church_denomination) between 2 and 200),
  add constraint mentor_nominations_region_location_check
    check (char_length(region_location) between 2 and 500);
