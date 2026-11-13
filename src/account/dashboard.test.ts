import { describe, expect, it } from 'vitest';
import { JOURNEY } from '../config/programme';
import { APPLICATION_STATUSES, PUBLISHED_STATUS_LABELS } from '../shared/platform';
import { checklist, checklistSummary, nextStep } from './dashboard';

describe('applicant dashboard: what happens next', () => {
  it('has a line for every status except a withdrawn application', () => {
    for (const status of APPLICATION_STATUSES) {
      if (status === 'withdrawn') expect(nextStep(status)).toBeNull();
      else expect(nextStep(status)).toMatch(/\S/);
    }
  });

  it('adds to the status description rather than repeating it', () => {
    for (const status of APPLICATION_STATUSES) {
      const next = nextStep(status);
      if (!next) continue;
      for (const sentence of PUBLISHED_STATUS_LABELS[status].description.split(/(?<=\.)\s+/)) expect(next).not.toContain(sentence);
      // The journey's review line is already in the "Received" description.
      expect(next).not.toContain(JOURNEY[0].next);
    }
  });

  it('never invents dates, response times or criteria', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(nextStep(status) ?? '').not.toMatch(/\d|days?|weeks?|soon|within|guarantee/i);
    }
  });
});

describe('applicant dashboard: checklist', () => {
  const all = { claimed: 1, claimable: 0, unread: 0, notifications: 'on' as const };

  it('is all done for a linked application, notifications on and nothing unread', () => {
    expect(checklist(all).map((item) => [item.id, item.done])).toEqual([
      ['application', true],
      ['notifications', true],
      ['messages', true],
    ]);
  });

  it('asks to link an application sent with this address, or to apply when there is none', () => {
    expect(checklist({ ...all, claimed: 0, claimable: 1 })[0]).toMatchObject({ done: false, to: '/account/application', label: 'Link your application to this account' });
    expect(checklist({ ...all, claimed: 0, claimable: 0 })[0]).toMatchObject({ done: false, to: '/apply' });
  });

  it('counts unread messages', () => {
    expect(checklist({ ...all, unread: 1 })[2]).toMatchObject({ done: false, label: 'Read your new message' });
    expect(checklist({ ...all, unread: 3 })[2]).toMatchObject({ done: false, label: 'Read your 3 new messages' });
  });

  it('follows what this device can do for notifications', () => {
    expect(checklist({ ...all, notifications: 'off' })[1]).toMatchObject({ done: false, to: '/account/notifications' });
    expect(checklist({ ...all, notifications: 'install-required' })[1]).toMatchObject({
      done: false,
      label: 'Add School of Purpose to your Home Screen to get notifications',
    });
    // Nothing to ask for when the browser or the site can't do it.
    expect(checklist({ ...all, notifications: 'unavailable' }).map((item) => item.id)).toEqual(['application', 'messages']);
  });

  it('leaves out what is still loading rather than guessing', () => {
    expect(checklist({}).length).toBe(0);
    expect(checklist({ unread: 0 }).map((item) => item.id)).toEqual(['messages']);
  });

  it('gives every open item a short action for its button, and done items none', () => {
    const open = checklist({ claimed: 0, claimable: 1, unread: 2, notifications: 'off' });
    expect(open.map((item) => item.action)).toEqual(['Link it', 'Turn on', 'Read']);
    expect(checklist({ claimed: 0, claimable: 0, notifications: 'install-required' }).map((item) => item.action)).toEqual(['Apply', 'How to']);
    expect(checklist(all).every((item) => item.action === undefined)).toBe(true);
  });

  it('counts what is done, and says when everything is', () => {
    expect(checklistSummary(checklist(all))).toEqual({ done: 3, total: 3, complete: true });
    expect(checklistSummary(checklist({ ...all, unread: 2 }))).toEqual({ done: 2, total: 3, complete: false });
    // An empty list (still loading) is never "complete".
    expect(checklistSummary([])).toEqual({ done: 0, total: 0, complete: false });
  });
});
