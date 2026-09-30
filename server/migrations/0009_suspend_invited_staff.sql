-- An owner withdraws an invitation by suspending the invited person (the Staff page's Suspend,
-- which also makes their invitation link unusable), but an invited person has no password yet, and
-- the table check allowed a missing password only while "invited". Suspended accounts may have none
-- too; reactivating one sends it back to "invited" (server/admin/platform.ts).
alter table staff_users drop constraint staff_users_check;
alter table staff_users add constraint staff_users_password_check check (status in ('invited', 'suspended') or password_hash is not null);
