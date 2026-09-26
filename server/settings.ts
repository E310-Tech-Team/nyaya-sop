/**
 * Operational settings owners can change in the admin area. Secrets never live here: they
 * stay in the environment.
 */
import type { Queryable } from './db';

export type Settings = {
  /** Shown to applicants as the support contact (falls back to the build-time contact email). */
  support_email: string | null;
  /** Lets owners switch applicant sign-in off (it is also off whenever email can't be sent). */
  applicant_accounts_enabled: boolean;
  /** Lets owners pause new anonymous (public) notification sign-ups. */
  public_notifications_enabled: boolean;
};

export const SETTING_DEFAULTS: Settings = {
  support_email: null,
  applicant_accounts_enabled: true,
  public_notifications_enabled: true,
};

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as (keyof Settings)[];

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(db: Queryable, maxAgeMs = 15_000): Promise<Settings> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.value;
  const { rows } = await db.query<{ key: string; value: unknown }>('select key, value from app_settings');
  const value: Settings = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if ((SETTING_KEYS as string[]).includes(row.key)) (value as Record<string, unknown>)[row.key] = row.value;
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function putSetting<K extends keyof Settings>(db: Queryable, key: K, value: Settings[K], staffId: string) {
  await db.query(
    `insert into app_settings (key, value, updated_by) values ($1, $2, $3)
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), staffId],
  );
  cache = null;
}

export const clearSettingsCache = () => {
  cache = null;
};

export async function setHeartbeat(db: Queryable, name: string) {
  await db.query(
    `insert into app_settings (key, value) values ($1, to_jsonb(now()))
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [`heartbeat_${name}`],
  );
}
