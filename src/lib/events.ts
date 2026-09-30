import type { AnalyticsEventName, AnalyticsProperties } from '../shared/platform';

/**
 * Reports one of the few anonymous product events the server accepts (docs/05 §Analytics): an
 * event name and coarse properties. No identifiers, no cookies, nothing typed by the person.
 * Fire-and-forget: a failure never affects the page.
 */
export function reportEvent(name: AnalyticsEventName, properties: AnalyticsProperties = {}): void {
  try {
    void fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      credentials: 'omit', // the server ignores cookies here: don't send them
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, properties }),
    }).catch(() => undefined);
  } catch {
    // fetch unavailable or blocked: nothing to do
  }
}
