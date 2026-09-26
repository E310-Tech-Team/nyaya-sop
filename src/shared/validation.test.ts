import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION, referenceFromId } from './application';
import { validPayload } from './test-fixtures';
import {
  MESSAGES,
  isHoneypotFilled,
  normalizePhone,
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

  it('limits the optional parish name', () => {
    expect(validatePersonal(validPayload({ parishName: 'x'.repeat(121) })).parishName).toBe(MESSAGES.parishTooLong);
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
        parishName: null,
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

describe('helpers', () => {
  it('detects the honeypot', () => {
    expect(isHoneypotFilled(validPayload())).toBe(false);
    expect(isHoneypotFilled(validPayload({ website: 'http://spam.example' }))).toBe(true);
  });

  it('derives a short reference', () => {
    expect(referenceFromId('7f3a9c2b-1d4e-4f00-8a1b-9c0d1e2f3a4b')).toBe('SOP-7F3A9C2B');
  });
});
