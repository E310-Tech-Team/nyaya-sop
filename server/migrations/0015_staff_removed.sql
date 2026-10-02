-- Removing a staff member (docs/05 §2, docs/06 D-61). An owner removes someone for good: every way
-- in goes (password, two-step methods, sessions, links, test devices) and they leave the staff
-- list. The account itself stays, closed, so their name stays on what they did (notes, decisions,
-- parish links, the audit history). Inviting the same address again reopens it as a new
-- invitation, with the name and role given then.
--
-- Additive. The release before this one shows a removed account as suspended (it is) and can't
-- sign anyone in with it (there is no password); its "Reactivate" is refused by the check below,
-- so nothing reopens a removed account except a new invitation.

alter table staff_users add column removed_at timestamptz;
alter table staff_users add constraint staff_users_removed_check
  check (removed_at is null or (status = 'suspended' and password_hash is null and mfa_enabled_at is null));
