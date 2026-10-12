import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_ROLES, type StaffRole } from '../src/shared/permissions';
import { asUser, createStaff, createTestContext, nextVisitor, staffSignIn, type TestContext } from './test-helpers';

// Mentor nominations in the admin area (docs/06 20.4, D-62).
let ctx: TestContext;
let as: Record<StaffRole, ReturnType<typeof asUser>>;
const ids: Record<StaffRole, string> = {} as never;

beforeEach(async () => {
  ctx = await createTestContext();
  as = {} as typeof as;
  for (const role of STAFF_ROLES) {
    const staff = await createStaff(ctx, { role });
    ids[role] = staff.id;
    as[role] = asUser(ctx.app, await staffSignIn(ctx, staff));
  }
});
afterEach(async () => {
  await ctx.close();
});

const nomination = (overrides: Record<string, unknown> = {}) => ({
  nominatorName: 'Adaeze Okafor',
  nomineeName: 'Chidi Nwosu',
  regionLocation: 'Lagos Region',
  nomineePhone: '0801 234 5678',
  nomineeEmail: 'chidi.nwosu@example.com',
  ageRange: '30_39',
  jobRole: 'Business owner',
  experience: 'More than ten years building teams and mentoring young professionals.',
  pillarFit: ['business_finance_entrepreneurship', 'technology_innovation'],
  rccgStatus: 'non_rccg',
  whyFit: 'Chidi has consistently guided young people and built successful teams in his field.',
  testimonial: 'He is dependable, generous with his time and an excellent example to others.',
  socialProfile: '',
  ...overrides,
});
const nominate = async (overrides: Record<string, unknown> = {}) => {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/mentor-nominations', remoteAddress: nextVisitor(), payload: nomination(overrides) });
  expect(res.statusCode).toBe(201);
  const { rows } = await ctx.db.query<{ id: string }>('select id from mentor_nominations order by created_at desc limit 1');
  return rows[0]!.id;
};
const list = async (query = '') => {
  const res = await as.owner({ url: `/api/admin/nominations${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as { total: number; all: number; page: number; pageSize: number; items: { id: string; nomineeName: string }[] };
};
const names = (body: { items: { nomineeName: string }[] }) => body.items.map((item) => item.nomineeName);
const audited = async (action: string) =>
  (await ctx.db.query<{ actor_id: string; target_id: string | null; details: unknown }>(`select actor_id, target_id, details from audit_events where action = $1`, [action])).rows;

describe('mentor nominations in the admin area', () => {
  it('are for owners and programme admins only', async () => {
    const id = await nominate();
    const allowed: StaffRole[] = ['owner', 'programme_admin'];
    for (const role of STAFF_ROLES) {
      const expected = allowed.includes(role) ? 200 : 403;
      for (const url of ['/api/admin/nominations', `/api/admin/nominations/${id}`, '/api/admin/nominations/export.csv']) {
        expect({ role, url, status: (await as[role]({ url })).statusCode }).toEqual({ role, url, status: expected });
      }
      if (!allowed.includes(role)) {
        expect((await as[role]({ method: 'POST', url: `/api/admin/nominations/${id}/delete`, payload: { confirm: 'chidi.nwosu@example.com' } })).statusCode).toBe(403);
      }
    }
    expect((await ctx.app.inject({ url: '/api/admin/nominations' })).statusCode).toBe(401);
  });

  it('lists them newest first, with search, filters and pages', async () => {
    expect(await list()).toMatchObject({ total: 0, all: 0, items: [] });
    await nominate({ nomineeName: 'Chidi Nwosu' });
    await nominate({ nomineeName: 'Funke Adeyemi', nomineeEmail: 'funke@example.com', ageRange: '40_49', rccgStatus: 'rccg_member', nominatorName: 'Grace Bello' });
    await nominate({ nomineeName: 'Tunde Ojo', nomineeEmail: 'tunde@example.com', regionLocation: 'Abuja', pillarFit: 'Media and creative arts' });

    const all = await list();
    expect(names(all)).toEqual(['Tunde Ojo', 'Funke Adeyemi', 'Chidi Nwosu']);
    expect(all).toMatchObject({ total: 3, all: 3 });
    expect(all.items[1]).toMatchObject({
      nomineeEmail: 'funke@example.com',
      nomineePhone: '0801 234 5678',
      ageRange: '40_49',
      rccgStatus: 'rccg_member',
      nominatorName: 'Grace Bello',
      regionLocation: 'Lagos Region',
      jobRole: 'Business owner',
      pillarFits: ['Business, Finance & Entrepreneurship', 'Technology & Innovation'],
    });
    // The long answers stay on the nomination's own page.
    expect(all.items[1]).not.toHaveProperty('testimonial');

    // Words in the nominee, email, location, role, pillar fit or nominator; any case.
    expect(names(await list('?q=GRACE'))).toEqual(['Funke Adeyemi']);
    expect(names(await list('?q=abuja'))).toEqual(['Tunde Ojo']);
    expect(names(await list('?q=creative'))).toEqual(['Tunde Ojo']);
    expect(names(await list('?q=funke%40example'))).toEqual(['Funke Adeyemi']);
    // LIKE wildcards are only characters.
    expect(await list('?q=%25')).toMatchObject({ total: 0, all: 3, items: [] });
    // Filters, together and apart; values the form doesn't offer are ignored.
    expect(names(await list('?age=40_49'))).toEqual(['Funke Adeyemi']);
    expect(names(await list('?rccg=non_rccg'))).toEqual(['Tunde Ojo', 'Chidi Nwosu']);
    expect(names(await list('?rccg=non_rccg&q=chidi'))).toEqual(['Chidi Nwosu']);
    expect((await list('?age=elderly&rccg=everyone')).total).toBe(3);
    // Pages.
    expect(await list('?pageSize=2&page=2')).toMatchObject({ page: 2, pageSize: 2, total: 3, items: [{ nomineeName: 'Chidi Nwosu' }] });
  });

  it('shows one in full and records that it was opened', async () => {
    const id = await nominate({ socialProfile: 'https://www.linkedin.com/in/chidi' });
    const res = await as.programme_admin({ url: `/api/admin/nominations/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id,
      submittedAt: expect.any(String),
      nomineeName: 'Chidi Nwosu',
      nomineeEmail: 'chidi.nwosu@example.com',
      nomineePhone: '0801 234 5678',
      nomineePhoneE164: '+2348012345678',
      regionLocation: 'Lagos Region',
      jobRole: 'Business owner',
      pillarFits: ['Business, Finance & Entrepreneurship', 'Technology & Innovation'],
      ageRange: '30_39',
      rccgStatus: 'non_rccg',
      nominatorName: 'Adaeze Okafor',
      experience: 'More than ten years building teams and mentoring young professionals.',
      whyFit: 'Chidi has consistently guided young people and built successful teams in his field.',
      testimonial: 'He is dependable, generous with his time and an excellent example to others.',
      socialProfile: 'https://www.linkedin.com/in/chidi',
    });
    expect(await audited('nomination.viewed')).toEqual([{ actor_id: ids.programme_admin, target_id: id, details: {} }]);
    for (const missing of ['00000000-0000-4000-8000-000000000000', 'not-an-id']) {
      expect((await as.owner({ url: `/api/admin/nominations/${missing}` })).statusCode).toBe(404);
    }
  });

  it('downloads them as CSV: every cell quoted, formulas defused, and the download recorded', async () => {
    await nominate();
    await nominate({ nomineeName: 'Funke Adeyemi', nomineeEmail: 'funke@example.com', ageRange: '40_49', jobRole: '=HYPERLINK("http://example.org")' });
    const res = await as.owner({ url: '/api/admin/nominations/export.csv?age=40_49' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="sop-mentor-nominations-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    const lines = res.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      '"Submitted (WAT)","Nominee","Nominee email","Nominee phone","Age range","Job role / profession","Region / base / location","RCCG status","Pillar fit","Experience","Why a good fit","Testimonial","Social media profile","Nominated by","Reference"',
    );
    expect(lines).toHaveLength(2); // the filter applies
    expect(lines[1]).toContain('"Funke Adeyemi","funke@example.com","0801 234 5678","40–49","\'=HYPERLINK(""http://example.org"")"');
    expect(await audited('nominations.exported')).toEqual([{ actor_id: ids.owner, target_id: null, details: { rows: 1, filters: ['age'] } }]);
  });

  it('deletes one when the nominee’s email address is typed back, and records that it was deleted', async () => {
    const id = await nominate();
    const remove = (confirm: string) => as.owner({ method: 'POST', url: `/api/admin/nominations/${id}/delete`, payload: { confirm } });
    expect((await remove('someone.else@example.com')).statusCode).toBe(400);
    expect((await remove('CHIDI.NWOSU@example.com')).statusCode).toBe(200);
    expect((await as.owner({ url: `/api/admin/nominations/${id}` })).statusCode).toBe(404);
    expect((await list()).all).toBe(0);
    expect((await remove('chidi.nwosu@example.com')).statusCode).toBe(404);
    expect(await audited('nomination.deleted')).toEqual([{ actor_id: ids.owner, target_id: id, details: {} }]);
  });
});
