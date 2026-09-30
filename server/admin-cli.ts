/**
 * Staff administration from the server's shell (docs/DEPLOYMENT.md):
 *
 *   pnpm admin create-owner --email you@example.org --name "Your Name"
 *       Creates the first owner and prints a single-use setup link (72 hours). No password is
 *       ever passed on the command line or committed anywhere.
 *   pnpm admin reset-mfa --email someone@example.org
 *       For a locked-out owner with no recovery codes: clears two-step verification and signs
 *       them out everywhere. They set it up again at next sign-in.
 *   pnpm admin reset-password --email someone@example.org
 *       When email isn't set up: prints a single-use password-reset link (30 minutes). The reset
 *       still asks for their two-step verification code (or a recovery code).
 *   pnpm admin list
 *
 * In production (built): node server-dist/admin.js create-owner --email … --name …
 */
import { parseArgs } from 'node:util';
import { isValidEmail, normalizeEmail } from '../src/shared/validation';
import { createServices } from './app';
import { audit, SYSTEM } from './audit';
import { revokeStaffSessions } from './auth/sessions';
import { createStaffInvite, siteLink } from './auth/staff-routes';
import { createAuthToken, voidStaffTokens } from './auth/tokens';
import { ConfigError, loadConfig, loadDotEnv } from './config';
import { createDb } from './db';
import { migrate } from './migrate';

loadDotEnv();
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: 'string' }, name: { type: 'string' } },
});
const command = positionals[0];

async function main() {
  const config = loadConfig();
  const db = await createDb(config);
  try {
    await migrate(db);
    const services = createServices(config, db);
    if (command === 'create-owner') {
      const email = normalizeEmail(values.email ?? '');
      const name = values.name?.trim();
      if (!isValidEmail(email) || !name) throw new Error('Usage: create-owner --email you@example.org --name "Your Name"');
      const result = await createStaffInvite(services, { email, displayName: name, role: 'owner', invitedBy: null });
      if (result === 'exists') throw new Error('A staff account with that email already exists (use the admin area, or reset-mfa).');
      await audit(db, SYSTEM, 'staff.bootstrap_owner', { type: 'staff', id: result.staffId });
      console.log(`Owner invitation created for ${email}.`);
      console.log('Open this link within 72 hours to choose a password and set up two-step verification.');
      console.log('Treat it like a password: anyone with it can finish setting up this owner account.\n');
      console.log(result.url);
    } else if (command === 'reset-mfa') {
      const email = normalizeEmail(values.email ?? '');
      const { rows } = await db.query<{ id: string }>(
        `update staff_users set mfa_secret_enc = null, mfa_pending_secret_enc = null, mfa_enabled_at = null, mfa_last_step = null
          where email = $1 returning id`,
        [email],
      );
      if (!rows[0]) throw new Error('No staff account with that email.');
      await db.query('delete from staff_recovery_codes where staff_id = $1', [rows[0].id]);
      await revokeStaffSessions(db, rows[0].id);
      await audit(db, SYSTEM, 'staff.mfa_reset', { type: 'staff', id: rows[0].id }, { via: 'cli' });
      console.log(`Two-step verification cleared for ${email}; all their sessions were signed out.`);
    } else if (command === 'reset-password') {
      const email = normalizeEmail(values.email ?? '');
      const { rows } = await db.query<{ id: string; status: string }>(`select id, status::text as status from staff_users where email = $1`, [email]);
      const staff = rows[0];
      if (!staff) throw new Error('No staff account with that email.');
      if (staff.status !== 'active') throw new Error(`That account is ${staff.status}; reactivate it (or resend the invitation) first.`);
      await voidStaffTokens(db, staff.id, ['staff_password_reset']); // only the newest link works
      const token = await createAuthToken(db, 'staff_password_reset', email, 30, staff.id);
      await audit(db, SYSTEM, 'staff.password_reset_link', { type: 'staff', id: staff.id }, { via: 'cli' });
      console.log(`Password-reset link for ${email} (single use, 30 minutes). Give it to them privately:\n`);
      console.log(siteLink(services, `/admin/reset?token=${token}`));
    } else if (command === 'list') {
      const { rows } = await db.query<{ email: string; role: string; status: string; mfa: boolean }>(
        `select email, role::text as role, status::text as status, mfa_enabled_at is not null as mfa from staff_users order by role, email`,
      );
      for (const row of rows) console.log(`${row.role.padEnd(16)} ${row.status.padEnd(10)} mfa:${row.mfa ? 'on ' : 'off'} ${row.email}`);
      if (!rows.length) console.log('No staff accounts yet. Run create-owner.');
    } else {
      throw new Error('Commands: create-owner --email … --name … | reset-mfa --email … | reset-password --email … | list');
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? `Configuration error: ${error.message}` : (error as Error).message);
  process.exit(1);
});
