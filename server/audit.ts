import type { Queryable } from './db';

export type AuditActor = { type: 'staff' | 'applicant' | 'system'; id: string | null };

export const SYSTEM: AuditActor = { type: 'system', id: null };

/**
 * Records who did what. `details` must hold identifiers, counts and field names only: never
 * personal data, message bodies or secrets.
 */
export async function audit(
  db: Queryable,
  actor: AuditActor,
  action: string,
  target?: { type: string; id: string } | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `insert into audit_events (actor_type, actor_id, action, target_type, target_id, details)
     values ($1, $2, $3, $4, $5, $6)`,
    [actor.type, actor.id, action, target?.type ?? null, target?.id ?? null, JSON.stringify(details)],
  );
}
