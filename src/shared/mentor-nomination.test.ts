import { describe, expect, it } from 'vitest';
import { validateMentorNomination } from './mentor-nomination';

const validNomination = (overrides: Record<string, unknown> = {}) => ({
  nominatorName: ' Adaeze Okafor ',
  nomineeName: 'Chidi Nwosu',
  regionLocation: ' Lagos Region ',
  nomineePhone: '0801 234 5678',
  nomineeEmail: 'CHIDI.NWOSU@example.com',
  ageRange: '30_39',
  jobRole: 'Business owner',
  experience: 'More than ten years building teams and mentoring young professionals.',
  pillarFit: 'Marketplace leadership',
  rccgStatus: 'non_rccg',
  whyFit: 'Chidi has consistently guided young people and built successful teams in his field.',
  testimonial: 'He is dependable, generous with his time and an excellent example to others.',
  socialProfile: '',
  ...overrides,
});

describe('validateMentorNomination', () => {
  it('cleans and normalises a complete nomination without excluding a Non-RCCG nominee', () => {
    expect(validateMentorNomination(validNomination())).toEqual({
      ok: true,
      value: {
        nominatorName: 'Adaeze Okafor',
        nomineeName: 'Chidi Nwosu',
        regionLocation: 'Lagos Region',
        nomineePhoneE164: '+2348012345678',
        nomineeEmail: 'chidi.nwosu@example.com',
        ageRange: '30_39',
        jobRole: 'Business owner',
        experience: 'More than ten years building teams and mentoring young professionals.',
        pillarFit: 'Marketplace leadership',
        rccgStatus: 'non_rccg',
        whyFit: 'Chidi has consistently guided young people and built successful teams in his field.',
        testimonial: 'He is dependable, generous with his time and an excellent example to others.',
        socialProfile: null,
      },
    });
  });

  it('rejects malformed bodies and invalid selectable answers', () => {
    expect(validateMentorNomination(null).ok).toBe(false);
    const result = validateMentorNomination(validNomination({ ageRange: '18_30', rccgStatus: 'unknown' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.ageRange).toBeDefined();
      expect(result.fieldErrors.rccgStatus).toBeDefined();
    }
  });

  it('requires meaningful pillar, fit and testimonial answers', () => {
    const result = validateMentorNomination(validNomination({ pillarFit: ' ', whyFit: 'yes', testimonial: 'ok' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.pillarFit).toBeDefined();
      expect(result.fieldErrors.whyFit).toBeDefined();
      expect(result.fieldErrors.testimonial).toBeDefined();
    }
  });
});
