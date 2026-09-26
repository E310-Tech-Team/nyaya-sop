/**
 * Minimal, documented product analytics (docs/05-Backend-Schema.md): an allowlisted event
 * name plus coarse properties. No identifiers, IP addresses, user agents or free text.
 */
import { ANALYTICS_EVENTS, type AnalyticsEventName, type AnalyticsProperties } from '../src/shared/platform';
import type { Queryable } from './db';
import { isUuid } from './http';

export const isAnalyticsEvent = (value: unknown): value is AnalyticsEventName =>
  ANALYTICS_EVENTS.includes(value as AnalyticsEventName);

/** Keeps only the known coarse properties. */
export function cleanProperties(input: unknown): AnalyticsProperties {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: AnalyticsProperties = {};
  if (raw.platform === 'android' || raw.platform === 'ios' || raw.platform === 'desktop' || raw.platform === 'other') out.platform = raw.platform;
  if (raw.displayMode === 'browser' || raw.displayMode === 'standalone') out.displayMode = raw.displayMode;
  if (isUuid(raw.messageId)) out.messageId = raw.messageId;
  return out;
}

export async function recordEvent(db: Queryable, name: AnalyticsEventName, properties: AnalyticsProperties = {}) {
  await db.query('insert into analytics_events (name, properties) values ($1, $2)', [name, JSON.stringify(cleanProperties(properties))]);
}
