/**
 * Staff linking an application to a parish (Applicant detail and Parish review). The parish ID
 * becomes the application's current parish; the applicant's own answer (what they typed, or the
 * snapshot they confirmed) never changes. Runs inside the caller's transaction.
 */
import { audit } from '../audit';
import type { Queryable } from '../db';

export class ParishLinkError extends Error {}

export type LinkResult = { from: string | null; to: string | null; reportsResolved: number };

/**
 * Links (or with null, unlinks) the application's parish, and resolves its pending parish
 * reports as linked. Unlinking reopens what the link had closed, so the answer returns to Parish review.
 */
export async function linkApplicationParish(db: Queryable, applicationId: string, parishId: string | null, staffId: string): Promise<LinkResult> {
  const { rows } = await db.query<{ parish_id: string | null; parish_status: string }>(
    `select parish_id, parish_status::text as parish_status from applications where id = $1 for update`,
    [applicationId],
  );
  const application = rows[0];
  if (!application) throw new ParishLinkError('Application not found.');
  if (parishId === application.parish_id) return { from: parishId, to: parishId, reportsResolved: 0 };

  let reportsResolved = 0;
  if (parishId === null) {
    if (application.parish_status === 'listed') throw new ParishLinkError('The applicant chose this parish. Choose the right parish instead of removing it.');
    await db.query(`update applications set parish_id = null, parish_linked_by = null, parish_linked_at = null, parish_text_reviewed_at = null where id = $1`, [applicationId]);
    await db.query(
      `update parish_reports set status = 'pending', resolved_parish_id = null, resolved_by = null, resolved_at = null
        where application_id = $1 and kind = 'not_listed' and status in ('linked', 'added')`,
      [applicationId],
    );
  } else {
    const parish = await db.query<{ status: string }>(`select status::text as status from parishes where id = $1`, [parishId]);
    if (!parish.rows[0]) throw new ParishLinkError('There is no parish with that ID.');
    if (parish.rows[0].status !== 'active') throw new ParishLinkError('That parish is no longer active. Choose an active one.');
    await db.query(`update applications set parish_id = $2, parish_linked_by = $3, parish_linked_at = now() where id = $1`, [applicationId, parishId, staffId]);
    const resolved = await db.query<{ n: number }>(
      `with resolved as (
         update parish_reports set status = 'linked', resolved_parish_id = $2, resolved_by = $3, resolved_at = now()
          where application_id = $1 and status = 'pending' returning 1)
       select count(*)::int as n from resolved`,
      [applicationId, parishId, staffId],
    );
    reportsResolved = resolved.rows[0]!.n;
  }
  await audit(db, { type: 'staff', id: staffId }, 'application.parish_changed', { type: 'application', id: applicationId }, {
    from: application.parish_id,
    to: parishId,
    reportsResolved,
  });
  return { from: application.parish_id, to: parishId, reportsResolved };
}
