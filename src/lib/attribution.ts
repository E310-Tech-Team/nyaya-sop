import type { SubmissionMeta } from '../shared/application';
import { sanitizeMeta } from '../shared/validation';
import { readSession, writeSession } from './storage';

const KEY = 'sop.attribution.v1';

/**
 * Remembers how the visitor arrived (utm_* link tags and the referring site) so the
 * Programme team can see which announcements and WhatsApp links bring applications.
 * First touch wins for the session. Values are cleaned and capped as the server stores them, so a
 * link with oversized or malformed tags can't make the application too large to send.
 */
export function captureAttribution(): void {
  if (readSession<SubmissionMeta>(KEY)) return;
  const params = new URLSearchParams(window.location.search);
  const meta: SubmissionMeta = {};
  const source = params.get('utm_source');
  const medium = params.get('utm_medium');
  const campaign = params.get('utm_campaign');
  if (source) meta.utmSource = source;
  if (medium) meta.utmMedium = medium;
  if (campaign) meta.utmCampaign = campaign;
  try {
    const referrer = document.referrer ? new URL(document.referrer) : null;
    if (referrer && referrer.host !== window.location.host) meta.referrer = referrer.host;
  } catch {
    // Unparseable referrer: ignore.
  }
  writeSession(KEY, sanitizeMeta(meta));
}

// Cleaned again on reading: the session may hold tags captured by an earlier version of the site.
export const readAttribution = (): SubmissionMeta => sanitizeMeta(readSession<SubmissionMeta>(KEY));
