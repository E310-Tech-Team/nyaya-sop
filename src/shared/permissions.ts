/**
 * Staff roles and what each may do. The server enforces these on every admin route
 * (server/auth/guards.ts); the admin UI only uses them to hide controls.
 * Keep STAFF_ROLES in step with the `staff_role` enum (server/migrations/0003).
 */

export const STAFF_ROLES = ['owner', 'programme_admin', 'reviewer', 'communications', 'read_only'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Owner',
  programme_admin: 'Programme admin',
  reviewer: 'Reviewer',
  communications: 'Communications',
  read_only: 'Read-only',
};

export const PERMISSIONS = [
  'dashboard.view',
  'applications.view_all', // every application, with personal details
  'applications.view_assigned', // only applications assigned to the reviewer
  'applications.note',
  'applications.review', // change the internal review status
  'applications.assign',
  'applications.publish', // publish an applicant-facing decision
  'applications.export',
  'applications.edit', // data corrections and deletion
  'accounts.view',
  'accounts.manage', // suspend, reactivate, revoke sessions, delete
  'cohorts.manage',
  'announcements.manage',
  'campaigns.manage', // draft, preview, test
  'campaigns.send', // schedule, send, cancel
  'staff.manage',
  'settings.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: ALL,
  programme_admin: ALL.filter((p) => p !== 'staff.manage' && p !== 'settings.manage'),
  reviewer: ['dashboard.view', 'applications.view_assigned', 'applications.note', 'applications.review'],
  communications: ['dashboard.view', 'announcements.manage', 'campaigns.manage', 'campaigns.send'],
  read_only: ['dashboard.view'],
};

export function can(role: StaffRole | null | undefined, permission: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(permission));
}

export const isStaffRole = (value: unknown): value is StaffRole => STAFF_ROLES.includes(value as StaffRole);
