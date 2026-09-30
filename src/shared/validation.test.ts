import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION, GENDERS, STORED_GENDERS, labelFor, referenceFromId, type ApplicationPayload } from './application';
import { validPayload } from './test-fixtures';
import {
  MESSAGES,
  cleanText,
  isHoneypotFilled,
  isValidEmail,
  normalizePhone,
  sanitizeMeta,
  truncate,
  validateApplication,
  validateEducation,
  validatePersonal,
  validatePurpose,
} from './validation';

describe('normalizePhone', () => {
  it.each([
    ['0801 234 5678', '+2348012345678'],
    ['08012345678', '+2348012345678'],
    ['0801-234-5678', '+2348012345678'],
    ['(0801) 234 5678', '+2348012345678'],
    ['8012345678', '+2348012345678'],
    ['2348012345678', '+2348012345678'],
    ['+234 801 234 5678', '+2348012345678'],
    ['+44 7700 900123', '+447700900123'],
    ['0044 7700 900123', '+447700900123'],
    ['+1 (415) 555-0100', '+14155550100'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '   ', '12345', '0801 234', 'call me', '+0 123 456 789', '+1234567890123456', '0801234567890'])(
    'rejects %j',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('validatePersonal', () => {
  it('accepts a complete section', () => {
    expect(validatePersonal(validPayload())).toEqual({});
  });

  it('reports every missing required field', () => {
    const errors = validatePersonal({
      fullName: '',
      email: '',
      phone: '',
      gender: '',
      ageRange: '',
      stateOfResidence: '',
      city: '',
      parishName: '',
    });
    expect(errors).toEqual({
      fullName: MESSAGES.fullNameRequired,
      email: MESSAGES.emailRequired,
      phone: MESSAGES.phoneRequired,
      gender: MESSAGES.genderRequired,
      ageRange: MESSAGES.ageRangeRequired,
      stateOfResidence: MESSAGES.stateRequired,
      city: MESSAGES.cityRequired,
    });
  });

  it('rejects malformed values', () => {
    const errors = validatePersonal(
      validPayload({ fullName: '12345', email: 'ada@example', phone: '555', stateOfResidence: 'Atlantis' }),
    );
    expect(errors.fullName).toBe(MESSAGES.fullNameLetters);
    expect(errors.email).toBe(MESSAGES.emailInvalid);
    expect(errors.phone).toBe(MESSAGES.phoneInvalid);
    expect(errors.stateOfResidence).toBe(MESSAGES.stateRequired);
  });

  it('accepts accented and Yoruba names', () => {
    expect(validatePersonal(validPayload({ fullName: 'Ọláolúwa Adébáyọ̀' }))).toEqual({});
  });

  it('limits the parish name’s length (whether an answer is needed depends on the directory: see below)', () => {
    expect(validatePersonal(validPayload({ parishName: 'x'.repeat(121) })).parishName).toBe(MESSAGES.parishTooLong);
  });
});

describe('gender: male or female (docs/06 D-54)', () => {
  const withGender = (gender: unknown) => ({ ...validPayload(), gender }) as unknown as ApplicationPayload;

  it('offers exactly Male and Female', () => {
    expect(GENDERS).toEqual([
      { value: 'male', label: 'Male' },
      { value: 'female', label: 'Female' },
    ]);
  });

  it('accepts male and female, in the form and on the server', () => {
    for (const gender of ['male', 'female']) {
      expect(validatePersonal(withGender(gender))).toEqual({});
      const result = validateApplication(withGender(gender));
      expect(result.ok && result.value.gender).toBe(gender);
    }
  });

  it('refuses "Prefer not to say", an empty answer and anything else', () => {
    const refused = ['prefer_not_to_say', 'Prefer not to say', '', ' ', 'Male', 'FEMALE', 'other', 'non_binary', 1, null, undefined, true, ['male'], { value: 'female' }];
    for (const gender of refused) {
      expect(validatePersonal(withGender(gender))).toEqual({ gender: MESSAGES.genderRequired });
      expect(validateApplication(withGender(gender))).toEqual({ ok: false, fieldErrors: { gender: MESSAGES.genderRequired } });
    }
  });

  it('still labels an earlier "Prefer not to say" answer for staff screens and exports', () => {
    expect(labelFor(STORED_GENDERS, 'prefer_not_to_say')).toBe('Prefer not to say (earlier form)');
    expect(labelFor(STORED_GENDERS, 'female')).toBe('Female');
    expect(labelFor(GENDERS, 'prefer_not_to_say')).toBe('');
  });
});

describe('validateEducation / validatePurpose', () => {
  it('requires one option each', () => {
    expect(validateEducation({ educationLevel: '', currentStatus: '' })).toEqual({
      educationLevel: MESSAGES.educationRequired,
      currentStatus: MESSAGES.statusRequired,
    });
    expect(validatePurpose({ purposeClarity: null })).toEqual({ purposeClarity: MESSAGES.purposeRequired });
    expect(validatePurpose({ purposeClarity: 6 })).toEqual({ purposeClarity: MESSAGES.purposeRequired });
    expect(validatePurpose({ purposeClarity: 5 })).toEqual({});
  });
});

describe('validateApplication', () => {
  it('normalises a valid payload', () => {
    const result = validateApplication({ ...validPayload(), meta: { utmSource: ' whatsapp ', junk: 'x' } });
    expect(result).toEqual({
      ok: true,
      value: {
        fullName: 'Adaeze Okafor',
        email: 'ada.okafor@example.com',
        phoneE164: '+2348012345678',
        gender: 'female',
        ageRange: '21_24',
        stateOfResidence: 'Lagos',
        city: 'Ikeja',
        parish: { kind: 'typed', name: 'Grace Chapel' },
        educationLevel: 'bachelors',
        currentStatus: 'employed',
        purposeClarity: 3,
        consentVersion: CONSENT_VERSION,
        meta: { utmSource: 'whatsapp' },
      },
    });
  });

  it('rejects non-object and wrongly-typed bodies without throwing', () => {
    for (const body of [null, 'text', 42, [], { fullName: 7, purposeClarity: '3' }]) {
      const result = validateApplication(body);
      expect(result.ok).toBe(false);
    }
  });

  it('requires a consent version', () => {
    const result = validateApplication(validPayload({ consentVersion: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.consentVersion).toBe(MESSAGES.consentRequired);
  });
});

describe('text that has to be stored (security audit)', () => {
  const EMOJI = '\u{1F600}';

  it('removes characters Postgres or JSON would refuse, keeping real text', () => {
    expect(cleanText('Ada\u0000 Obi')).toBe('Ada Obi');
    expect(cleanText('Ada \u0000 Obi\u0007')).toBe('Ada Obi');
    expect(cleanText('Ada\nObi\t Ọlá')).toBe('Ada Obi Ọlá');
    expect(cleanText(`lone \ud83d half ${EMOJI}`)).toBe(`lone half ${EMOJI}`);
    expect(cleanText('\udc00')).toBe('');
  });

  it('cuts to a number of characters without splitting an emoji', () => {
    expect(truncate(`${'a'.repeat(119)}${EMOJI}tail`, 120)).toBe(`${'a'.repeat(119)}${EMOJI}`);
    expect(truncate(`${'a'.repeat(118)} ${EMOJI}`, 119)).toBe('a'.repeat(118));
    expect(truncate('short', 120)).toBe('short');
  });

  it('stores link tags a crafted link could otherwise use to break the form', () => {
    const meta = sanitizeMeta({ utmSource: '\u0000', utmMedium: `${'m'.repeat(119)}${EMOJI}${EMOJI}`, utmCampaign: 'x'.repeat(10_000), referrer: 7 });
    expect(meta).toEqual({ utmMedium: `${'m'.repeat(119)}${EMOJI}`, utmCampaign: 'x'.repeat(120) });
    expect(JSON.stringify(meta)).not.toMatch(/\\u(d[89a-f]|00)/i);
  });

  it('refuses email addresses mail software would read as syntax, or that hide characters', () => {
    for (const email of ['first.last+tag@example.co.uk', "o'brien@example.com", 'adé@exämple.ng']) expect(isValidEmail(email)).toBe(true);
    for (const email of ['a,victim@example.com', 'a;b@example.com', '<a@example.com>', 'a"b@example.com', 'a(b)@example.com', 'a\u0000@example.com', 'a@exa\u200bmple.com', 'a\\b@example.com']) {
      expect(isValidEmail(email)).toBe(false);
    }
  });
});

describe('helpers', () => {
  it('detects the honeypot', () => {
    expect(isHoneypotFilled(validPayload())).toBe(false);
    expect(isHoneypotFilled(validPayload({ website: 'http://spam.example' }))).toBe(true);
  });

  it('derives a short reference', () => {
    expect(referenceFromId('7f3a9c2b-1d4e-4f00-8a1b-9c0d1e2f3a4b')).toBe('SOP-7F3A9C2B');
  });
});

describe('the parish answer', () => {
  const id = '3f2a1c9e-7b4d-4e8a-9c1f-2d3e4f5a6b7c';
  const withParish = (parish: unknown) => ({ ...validPayload(), parish });
  const parishOf = (result: ReturnType<typeof validateApplication>) => (result.ok ? result.value.parish : result.fieldErrors.parishName);

  it('never takes typed text as the answer while the directory is on, so a request can’t skip the question', () => {
    const typedOnly = validPayload({ parishName: 'Jesus House' });
    expect(parishOf(validateApplication(typedOnly, { directory: true }))).toBe(MESSAGES.parishRequired);
    expect('parish' in typedOnly).toBe(false);
    expect(parishOf(validateApplication({ ...typedOnly, parish: undefined }, { directory: true }))).toBe(MESSAGES.parishRequired);
    expect(parishOf(validateApplication(validPayload({ parishName: '' }), { directory: true }))).toBe(MESSAGES.parishRequired);
  });

  it('requires the parish’s name while the directory is off', () => {
    expect(parishOf(validateApplication(validPayload({ parishName: '' })))).toBe(MESSAGES.parishTextRequired);
    expect(parishOf(validateApplication(validPayload({ parishName: '   ' })))).toBe(MESSAGES.parishTextRequired);
    expect(parishOf(validateApplication(validPayload({ parishName: ' 12 ' })))).toBe(MESSAGES.parishNameInvalid);
    expect(parishOf(validateApplication(validPayload({ parishName: '  Jesus   House ' })))).toEqual({ kind: 'typed', name: 'Jesus House' });
  });

  it('still honours an answer from the directory while it is off (a draft made while it was on)', () => {
    expect(parishOf(validateApplication(withParish({ kind: 'listed', id, confirmed: true }), { directory: false }))).toEqual({
      kind: 'listed',
      parishId: id,
      detailsWrong: false,
    });
  });

  it('keeps only the parish’s ID from the browser: its units come from the directory', () => {
    const forged = { kind: 'listed', id, confirmed: true, name: 'Made Up', chain: { continent: { id: 'x', name: 'Continent 99' } }, provinceId: 'y' };
    expect(parishOf(validateApplication(withParish(forged), { directory: true }))).toEqual({ kind: 'listed', parishId: id, detailsWrong: false });
  });

  it('takes a confirmed listed parish, with or without a details flag', () => {
    expect(parishOf(validateApplication(withParish({ kind: 'listed', id: id.toUpperCase(), confirmed: true })))).toEqual({
      kind: 'listed',
      parishId: id,
      detailsWrong: false,
    });
    expect(parishOf(validateApplication(withParish({ kind: 'listed', id, confirmed: true, detailsWrong: true })))).toEqual({
      kind: 'listed',
      parishId: id,
      detailsWrong: true,
    });
  });

  it('needs a listed parish confirmed', () => {
    expect(parishOf(validateApplication(withParish({ kind: 'listed', id, confirmed: false })))).toBe(MESSAGES.parishConfirm);
    expect(parishOf(validateApplication(withParish({ kind: 'listed', id: 'not-an-id', confirmed: true })))).toBe(MESSAGES.parishRequired);
  });

  it('takes the name of a parish that is not listed', () => {
    expect(parishOf(validateApplication(withParish({ kind: 'not_listed', name: ' Grace  Chapel ' })))).toEqual({ kind: 'not_listed', name: 'Grace Chapel' });
    expect(parishOf(validateApplication(withParish({ kind: 'not_listed', name: ' ' })))).toBe(MESSAGES.parishNameRequired);
    expect(parishOf(validateApplication(withParish({ kind: 'not_listed', name: '12' })))).toBe(MESSAGES.parishNameInvalid);
    expect(parishOf(validateApplication(withParish({ kind: 'not_listed', name: 'x'.repeat(121) })))).toBe(MESSAGES.parishNameInvalid);
  });

  it('requires an answer from the directory while it is on: empty, unknown kinds and malformed IDs don’t count', () => {
    expect(parishOf(validateApplication(withParish(null), { directory: true }))).toBe(MESSAGES.parishRequired);
    expect(parishOf(validateApplication(withParish({ kind: 'other' }), { directory: true }))).toBe(MESSAGES.parishRequired);
    expect(parishOf(validateApplication(withParish({ kind: 'typed', name: 'Grace Chapel' }), { directory: true }))).toBe(MESSAGES.parishRequired);
    expect(parishOf(validateApplication(withParish({ kind: 'listed', id: '', confirmed: true }), { directory: true }))).toBe(MESSAGES.parishRequired);
    expect(parishOf(validateApplication(withParish('Jesus House'), { directory: true }))).toBe(MESSAGES.parishRequired);
    // Directory off and no answer from it: the typed name answers the question.
    expect(parishOf(validateApplication(withParish(null)))).toEqual({ kind: 'typed', name: 'Grace Chapel' });
  });
});
