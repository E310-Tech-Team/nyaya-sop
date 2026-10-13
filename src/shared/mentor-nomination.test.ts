import { describe, expect, it } from 'vitest';
import { validateMentorNomination } from './mentor-nomination';

const validNomination = (overrides: Record<string, unknown> = {}) => ({
  nominatorName: ' Adaeze Okafor ',
  nomineeName: 'Chidi Nwosu',
  nomineeState: 'Lagos',
  regionLocation: ' 12 Example Street, Lagos, Nigeria ',
  provinceId: '',
  churchDenomination: '  Redeemed Christian Church of God ',
  nomineePhone: '0801 234 5678',
  nomineeEmail: 'CHIDI.NWOSU@example.com',
  ageRange: '30_39',
  jobRole: 'Business owner',
  experience: 'More than ten years building teams and mentoring young professionals.',
  pillarFit: 'business_finance_entrepreneurship',
  rccgStatus: 'non_rccg',
  whyFit: 'Chidi has consistently guided young people and built successful teams in his field.',
  testimonial: 'He is dependable, generous with his time and an excellent example to others.',
  ...overrides,
});

describe('validateMentorNomination', () => {
  it('cleans and normalises a complete nomination without excluding a Non-RCCG nominee', () => {
    expect(validateMentorNomination(validNomination())).toEqual({
      ok: true,
      value: {
        nominatorName: 'Adaeze Okafor',
        nomineeName: 'Chidi Nwosu',
        nomineeState: 'Lagos',
        regionLocation: '12 Example Street, Lagos, Nigeria',
        provinceId: null,
        churchDenomination: 'Redeemed Christian Church of God',
        nomineePhoneE164: '+2348012345678',
        nomineeEmail: 'chidi.nwosu@example.com',
        ageRange: '30_39',
        jobRole: 'Business owner',
        experience: 'More than ten years building teams and mentoring young professionals.',
        pillarFit: 'business_finance_entrepreneurship',
        rccgStatus: 'non_rccg',
        whyFit: 'Chidi has consistently guided young people and built successful teams in his field.',
        testimonial: 'He is dependable, generous with his time and an excellent example to others.',
      },
    });
  });

  it('requires state and the matching conditional location details', () => {
    const rccg = validateMentorNomination(
      validNomination({ rccgStatus: 'rccg_member', regionLocation: '', churchDenomination: '', provinceId: 'province-id' }),
    );
    expect(rccg).toMatchObject({
      ok: true,
      value: { nomineeState: 'Lagos', provinceId: 'province-id', regionLocation: '', churchDenomination: null },
    });

    const missingProvince = validateMentorNomination(validNomination({ rccgStatus: 'rccg_member', regionLocation: '' }));
    expect(missingProvince).toMatchObject({ ok: false, fieldErrors: { provinceId: expect.any(String) } });

    const missingNonRccgDetails = validateMentorNomination(validNomination({ regionLocation: '', churchDenomination: '' }));
    expect(missingNonRccgDetails).toMatchObject({
      ok: false,
      fieldErrors: { regionLocation: expect.any(String), churchDenomination: expect.any(String) },
    });
    const missingState = validateMentorNomination(validNomination({ nomineeState: '' }));
    expect(missingState).toMatchObject({ ok: false, fieldErrors: { nomineeState: expect.any(String) } });
    const invalidState = validateMentorNomination(validNomination({ nomineeState: 'Atlantis' }));
    expect(invalidState).toMatchObject({ ok: false, fieldErrors: { nomineeState: expect.any(String) } });
  });

  it('rejects malformed bodies and invalid selectable answers', () => {
    expect(validateMentorNomination(null).ok).toBe(false);
    const result = validateMentorNomination(validNomination({ ageRange: '18_29', rccgStatus: 'unknown' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.ageRange).toBeDefined();
      expect(result.fieldErrors.rccgStatus).toBeDefined();
    }
  });

  it('accepts the new split age ranges without accepting the earlier 18–29 choice', () => {
    for (const ageRange of ['18_24', '25_29']) {
      expect(validateMentorNomination(validNomination({ ageRange })).ok).toBe(true);
    }
    expect(validateMentorNomination(validNomination({ ageRange: '18_29' })).ok).toBe(false);
  });

  it('requires meaningful pillar, fit and testimonial answers', () => {
    const result = validateMentorNomination(validNomination({ pillarFit: '', whyFit: 'yes', testimonial: 'ok' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.pillarFit).toBeDefined();
      expect(result.fieldErrors.whyFit).toBeDefined();
      expect(result.fieldErrors.testimonial).toBeDefined();
    }
  });

  it('accepts one official pillar and rejects unknown or multiple choices', () => {
    expect(validateMentorNomination(validNomination({ pillarFit: 'education_academia' })).ok).toBe(true);
    expect(validateMentorNomination(validNomination({ pillarFit: ['media_communications'] })).ok).toBe(true);
    for (const pillarFit of ['made_up_pillar', ['business_finance_entrepreneurship', 'technology_innovation']]) {
      const result = validateMentorNomination(validNomination({ pillarFit }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors.pillarFit).toBeDefined();
    }
  });
});
