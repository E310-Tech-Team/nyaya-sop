/**
 * Gender has two options, male and female (docs/06 D-54). Applications saved with the earlier
 * "Prefer not to say" keep it (migration 0011) and stay visible, countable and workable for staff.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENDERS, STORED_GENDERS, referenceFromId } from '../src/shared/application';
import { validPayload } from '../src/shared/test-fixtures';
import { MESSAGES } from '../src/shared/validation';
import { parseCsv } from './csv';
import { createPgliteDb, type Queryable } from './db';
import { migrate } from './migrate';
import { asUser, createStaff, createTestContext, nextVisitor, staffSignIn, type Session, type TestContext } from './test-helpers';

let ctx: TestContext;
let admin: Session;

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await staffSignIn(ctx, await createStaff(ctx, { role: 'programme_admin' }));
});
afterAll(() => ctx?.close());

const submit = (body: object) => ctx.app.inject({ method: 'POST', url: '/api/applications', remoteAddress: nextVisitor(), payload: body });
const staff = () => asUser(ctx.app, admin);
const genderOf = async (id: string) =>
  (await ctx.db.query<{ gender: string }>('select gender::text as gender from applications where id = $1', [id])).rows[0]?.gender;

/** An application written straight to the table, as the form's server never would. */
const insertApplication = async (db: Queryable, email: string, gender: string) =>
  (
    await db.query<{ id: string }>(
      `insert into applications (cohort_id, full_name, email, phone_e164, gender, age_range, state_of_residence, city,
                                 education_level, current_status, purpose_clarity, consent_version)
       select id, 'Adaeze Okafor', $1, '+2348012345678', $2::gender, '21_24', 'Lagos', 'Ikeja', 'bachelors', 'employed', 3, '2026-09-v1'
         from cohorts where slug = 'called-generation-1'
       returning id`,
      [email, gender],
    )
  ).rows[0]!.id;

/** An application saved with "Prefer not to say" before migration 0011 (the trigger is off only while it's written). */
async function earlierApplication(email: string): Promise<string> {
  await ctx.db.exec('alter table applications disable trigger applications_gender_offered');
  try {
    return await insertApplication(ctx.db, email, 'prefer_not_to_say');
  } finally {
    await ctx.db.exec('alter table applications enable trigger applications_gender_offered');
  }
}

const CHECK_VIOLATION = { code: '23514', message: expect.stringContaining('must be male or female') };

describe('the gender options', () => {
  it('are male and female; the database enum still holds the earlier value, in the same order', async () => {
    expect(GENDERS.map(({ value, label }) => [value, label])).toEqual([
      ['male', 'Male'],
      ['female', 'Female'],
    ]);
    const { rows } = await ctx.db.query<{ value: string }>('select unnest(enum_range(null::gender))::text as value');
    expect(rows.map((row) => row.value)).toEqual(STORED_GENDERS.map((option) => option.value));
  });
});

describe('POST /api/applications', () => {
  it('stores male and female answers', async () => {
    for (const gender of ['male', 'female'] as const) {
      const res = await submit(validPayload({ email: `${gender}@example.com`, gender }));
      expect(res.statusCode).toBe(201);
      expect(await genderOf(res.json().id)).toBe(gender);
    }
  });

  it('refuses "Prefer not to say", an empty answer or anything else with a field error, and stores nothing', async () => {
    const { gender: _omitted, ...withoutGender } = validPayload({ email: 'no.gender@example.com' });
    const bodies = [
      withoutGender,
      ...['prefer_not_to_say', 'Prefer not to say', '', ' ', 'Male', 'other', 'non_binary', 1, null, true, ['male'], { value: 'female' }].map(
        (gender, index) => ({ ...validPayload({ email: `refused.${index}@example.com` }), gender }),
      ),
    ];
    for (const body of bodies) {
      const res = await submit(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { gender: MESSAGES.genderRequired } });
      expect(Object.keys(res.json().fieldErrors)).toEqual(['gender']);
    }
    const { rows } = await ctx.db.query<{ n: number }>(`select count(*)::int as n from applications where email like 'refused.%' or email = 'no.gender@example.com'`);
    expect(rows[0]!.n).toBe(0);
  });
});

describe('the database trigger (migration 0011)', () => {
  it('refuses a new row with "Prefer not to say", even one written straight to the table', async () => {
    await expect(insertApplication(ctx.db, 'direct@example.com', 'prefer_not_to_say')).rejects.toMatchObject(CHECK_VIOLATION);
    expect(await genderOf(await insertApplication(ctx.db, 'direct@example.com', 'male'))).toBe('male');
  });

  it('keeps an earlier row workable: other updates and a change to male or female, but never back', async () => {
    const id = await earlierApplication('earlier.row@example.com');
    await ctx.db.query(`update applications set status = 'under_review', city = 'Ibadan' where id = $1`, [id]);
    await ctx.db.query('update applications set gender = gender where id = $1', [id]);
    expect(await genderOf(id)).toBe('prefer_not_to_say');

    await ctx.db.query(`update applications set gender = 'female' where id = $1`, [id]);
    expect(await genderOf(id)).toBe('female');
    await expect(ctx.db.query(`update applications set gender = 'prefer_not_to_say' where id = $1`, [id])).rejects.toMatchObject(CHECK_VIOLATION);
    expect(await genderOf(id)).toBe('female');
  });

  it('applies over applications already saved with "Prefer not to say", keeping them', async () => {
    const db = await createPgliteDb('memory://');
    try {
      await migrate(db);
      // The schema as it was before 0011, holding an application saved then.
      await db.exec(`drop trigger applications_gender_offered on applications;
                     drop function applications_gender_offered();
                     delete from schema_migrations where version = '0011_gender_two_options';`);
      const id = await insertApplication(db, 'saved.before@example.com', 'prefer_not_to_say');

      expect(await migrate(db)).toEqual(['0011_gender_two_options']);
      const kept = await db.query<{ gender: string }>('select gender::text as gender from applications where id = $1', [id]);
      expect(kept.rows).toEqual([{ gender: 'prefer_not_to_say' }]);
      await db.query(`update applications set status = 'shortlisted' where id = $1`, [id]);
      await expect(insertApplication(db, 'saved.after@example.com', 'prefer_not_to_say')).rejects.toMatchObject(CHECK_VIOLATION);
    } finally {
      await db.close();
    }
  });
});

describe('earlier applications in the admin area', () => {
  it('are listed, shown, exported and counted with their own label', async () => {
    const id = await earlierApplication('earlier.admin@example.com');
    const female = (await submit(validPayload({ email: 'female.admin@example.com' }))).json().id as string;

    const detail = (await staff()({ url: `/api/admin/applicants/${id}` })).json();
    expect(detail.personal.gender).toBe('Prefer not to say (earlier form)');
    expect((await staff()({ url: `/api/admin/applicants/${female}` })).json().personal.gender).toBe('Female');

    const list = (await staff()({ url: '/api/admin/applicants?q=earlier.admin' })).json();
    expect(list.items.map((item: { id: string }) => item.id)).toEqual([id]);

    const [header, ...rows] = parseCsv((await staff()({ url: '/api/admin/applicants/export.csv' })).body);
    const genderIn = (rowId: string) => rows.find((row) => row[header!.indexOf('Reference')] === referenceFromId(rowId))?.[header!.indexOf('Gender')];
    expect(genderIn(id)).toBe('Prefer not to say (earlier form)');
    expect(genderIn(female)).toBe('Female');

    const { rows: all } = await ctx.db.query<{ n: number }>('select count(*)::int as n from applications');
    expect((await staff()({ url: '/api/admin/reports/summary' })).json().applications).toBe(all[0]!.n);
  });

  it('can be reviewed, published and corrected; staff can’t change any application’s gender', async () => {
    const id = await earlierApplication('earlier.staff@example.com');
    expect((await staff()({ method: 'POST', url: `/api/admin/applicants/${id}/status`, payload: { status: 'under_review' } })).statusCode).toBe(200);
    expect((await staff()({ method: 'POST', url: `/api/admin/applicants/${id}/publish`, payload: { expectedStatus: 'under_review' } })).statusCode).toBe(200);

    const corrected = await staff()({ method: 'POST', url: `/api/admin/applicants/${id}/correct`, payload: { city: 'Ibadan', gender: 'male' } });
    expect(corrected.json()).toEqual({ ok: true, changed: ['city'] });
    expect(await genderOf(id)).toBe('prefer_not_to_say');

    const female = (await submit(validPayload({ email: 'female.staff@example.com' }))).json().id as string;
    const ignored = await staff()({ method: 'POST', url: `/api/admin/applicants/${female}/correct`, payload: { gender: 'prefer_not_to_say' } });
    expect(ignored.json()).toEqual({ ok: true, changed: [] });
    expect(await genderOf(female)).toBe('female');
  });
});
