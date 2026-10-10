create type mentor_nominee_age_range as enum ('18_29', '30_39', '40_49', '50_59', '60_plus');
create type mentor_nominee_rccg_status as enum ('rccg_member', 'non_rccg');

create table mentor_nominations (
  id                    uuid primary key default gen_random_uuid(),
  nominator_name        text not null check (char_length(nominator_name) between 2 and 120),
  nominee_name          text not null check (char_length(nominee_name) between 2 and 120),
  region_location       text not null check (char_length(region_location) between 2 and 120),
  nominee_phone_e164    text not null check (nominee_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  nominee_email         text not null check (char_length(nominee_email) between 3 and 254 and nominee_email = lower(nominee_email)),
  nominee_age_range     mentor_nominee_age_range not null,
  job_role              text not null check (char_length(job_role) between 2 and 120),
  experience            text not null check (char_length(experience) between 2 and 1200),
  pillar_fit            text not null check (char_length(pillar_fit) between 2 and 300),
  nominee_rccg_status   mentor_nominee_rccg_status not null,
  why_fit               text not null check (char_length(why_fit) between 20 and 1500),
  testimonial           text not null check (char_length(testimonial) between 10 and 1500),
  social_profile        text check (social_profile is null or char_length(social_profile) <= 300),
  created_at            timestamptz not null default now()
);

create index mentor_nominations_created_idx on mentor_nominations (created_at desc);
