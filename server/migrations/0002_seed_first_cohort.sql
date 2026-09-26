-- Reference data for launch: the consent wording shown in the form and the first cohort.
-- To close applications later:
--   update cohorts set is_accepting_applications = false where slug = 'called-generation-1';

insert into consent_versions (version, statement) values (
  '2026-09-v1',
  'I confirm that I am an RCCG member aged 18-30 and consent to being contacted about this programme.'
);

insert into cohorts (slug, name, edition, is_accepting_applications)
values ('called-generation-1', 'The Called Generation', 1, true);
