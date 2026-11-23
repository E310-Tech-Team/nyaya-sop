-- Age limits by continent (06 D-65): 18–30, or up to 35 in Continent 1 and up to 40 in
-- Continents 2 and 11. Additive: the release before this one never stores the new values, and
-- forms opened under the earlier consent (2026-09-v1) still submit with it.
alter type age_range add value if not exists '31_35' after '28_30';
alter type age_range add value if not exists '36_40' after '31_35';

insert into consent_versions (version, statement) values (
  '2026-11-v1',
  'I confirm that I am an RCCG member aged 18–30, or up to 35 in Continent 1 and up to 40 in Continents 2 and 11, and consent to being contacted about this programme.'
) on conflict (version) do nothing;
