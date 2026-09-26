/**
 * Validation + normalisation rules shared by the form (instant feedback) and the
 * API server (the authority). Any rule added here applies to both.
 */
import {
  AGE_RANGES,
  CURRENT_STATUSES,
  EDUCATION_LEVELS,
  GENDERS,
  PURPOSE_SCALE,
  STATE_OPTIONS,
  type AgeRange,
  type CurrentStatus,
  type EducationAnswers,
  type EducationLevel,
  type FieldErrors,
  type Gender,
  type NormalizedApplication,
  type PersonalAnswers,
  type PurposeAnswers,
  type SubmissionMeta,
} from './application';

export const LIMITS = {
  fullName: { min: 2, max: 120 },
  email: { max: 254 },
  city: { min: 2, max: 80 },
  parishName: { max: 120 },
  consentVersion: { max: 40 },
  metaValue: { max: 120 },
} as const;

export const MESSAGES = {
  fullNameRequired: 'Enter your full name',
  fullNameTooShort: 'Enter your full name (at least 2 characters)',
  fullNameTooLong: `Your name must be ${LIMITS.fullName.max} characters or fewer`,
  fullNameLetters: 'Enter your name using letters',
  emailRequired: 'Enter your email address',
  emailInvalid: 'Enter a valid email address, like name@example.com',
  phoneRequired: 'Enter your phone number',
  phoneInvalid: 'Enter a valid phone number, like 0801 234 5678 or +44 7700 900123',
  genderRequired: 'Select your gender',
  ageRangeRequired: 'Select your age range',
  stateRequired: 'Select your state of residence',
  cityRequired: 'Enter your city or town',
  cityInvalid: `Enter your city or town (${LIMITS.city.min}–${LIMITS.city.max} characters)`,
  parishTooLong: `Parish name must be ${LIMITS.parishName.max} characters or fewer`,
  educationRequired: 'Choose your highest level of education',
  statusRequired: 'Choose your current status',
  purposeRequired: 'Choose a number from 1 to 5',
  consentRequired: 'Please confirm the consent statement',
} as const;

const HAS_LETTER = /\p{L}/u;
// Pragmatic check: something@domain.tld, no spaces. Deliverability is confirmed by the reply email.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length <= LIMITS.email.max && EMAIL_RE.test(email);
}

/**
 * Normalises a phone number to E.164 (+2348012345678).
 * Accepts Nigerian local formats (0801 234 5678, 8012345678, 234…) and any
 * international number written with + or 00. Returns null if it can't be a phone number.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const international = trimmed.startsWith('+');
  const digits = trimmed.replace(/^\+/, '').replace(/[\s\-().]/g, '');
  if (!/^\d+$/.test(digits)) return null;

  const e164 = (national: string) => (/^[1-9]\d{7,14}$/.test(national) ? `+${national}` : null);

  if (international) return e164(digits);
  if (digits.startsWith('00')) return e164(digits.slice(2));
  if (/^0[1-9]\d{9}$/.test(digits)) return `+234${digits.slice(1)}`; // 0801 234 5678
  if (/^234[1-9]\d{9}$/.test(digits)) return `+${digits}`; // 2348012345678
  if (/^[789][01]\d{8}$/.test(digits)) return `+234${digits}`; // 8012345678 (dropped leading 0)
  return null;
}

const isOneOf = <V>(options: readonly { readonly value: V }[], value: unknown): value is V =>
  options.some((option) => option.value === value);

export function validatePersonal(answers: PersonalAnswers): FieldErrors {
  const errors: FieldErrors = {};

  const name = collapseWhitespace(answers.fullName);
  if (!name) errors.fullName = MESSAGES.fullNameRequired;
  else if (name.length < LIMITS.fullName.min) errors.fullName = MESSAGES.fullNameTooShort;
  else if (name.length > LIMITS.fullName.max) errors.fullName = MESSAGES.fullNameTooLong;
  else if (!HAS_LETTER.test(name)) errors.fullName = MESSAGES.fullNameLetters;

  if (!answers.email.trim()) errors.email = MESSAGES.emailRequired;
  else if (!isValidEmail(answers.email)) errors.email = MESSAGES.emailInvalid;

  if (!answers.phone.trim()) errors.phone = MESSAGES.phoneRequired;
  else if (!normalizePhone(answers.phone)) errors.phone = MESSAGES.phoneInvalid;

  if (!isOneOf(GENDERS, answers.gender)) errors.gender = MESSAGES.genderRequired;
  if (!isOneOf(AGE_RANGES, answers.ageRange)) errors.ageRange = MESSAGES.ageRangeRequired;
  if (!STATE_OPTIONS.includes(answers.stateOfResidence)) errors.stateOfResidence = MESSAGES.stateRequired;

  const city = collapseWhitespace(answers.city);
  if (!city) errors.city = MESSAGES.cityRequired;
  else if (city.length < LIMITS.city.min || city.length > LIMITS.city.max || !HAS_LETTER.test(city)) {
    errors.city = MESSAGES.cityInvalid;
  }

  if (collapseWhitespace(answers.parishName).length > LIMITS.parishName.max) {
    errors.parishName = MESSAGES.parishTooLong;
  }
  return errors;
}

export function validateEducation(answers: EducationAnswers): FieldErrors {
  const errors: FieldErrors = {};
  if (!isOneOf(EDUCATION_LEVELS, answers.educationLevel)) errors.educationLevel = MESSAGES.educationRequired;
  if (!isOneOf(CURRENT_STATUSES, answers.currentStatus)) errors.currentStatus = MESSAGES.statusRequired;
  return errors;
}

export function validatePurpose(answers: PurposeAnswers): FieldErrors {
  const errors: FieldErrors = {};
  if (!isOneOf(PURPOSE_SCALE, answers.purposeClarity)) errors.purposeClarity = MESSAGES.purposeRequired;
  return errors;
}

export const hasErrors = (errors: FieldErrors): boolean => Object.keys(errors).length > 0;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function sanitizeMeta(meta: unknown): SubmissionMeta {
  if (!meta || typeof meta !== 'object') return {};
  const source = meta as Record<string, unknown>;
  const clean: SubmissionMeta = {};
  for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'referrer'] as const) {
    const value = collapseWhitespace(str(source[key])).slice(0, LIMITS.metaValue.max);
    if (value) clean[key] = value;
  }
  return clean;
}

/** True when the hidden honeypot field was filled in (almost certainly a bot). */
export function isHoneypotFilled(input: unknown): boolean {
  return !!input && typeof input === 'object' && str((input as Record<string, unknown>).website).trim() !== '';
}

export type ValidationResult =
  | { ok: true; value: NormalizedApplication }
  | { ok: false; fieldErrors: FieldErrors };

/** Full check of an untrusted request body (the server's entry point). */
export function validateApplication(input: unknown): ValidationResult {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const personal: PersonalAnswers = {
    fullName: str(body.fullName),
    email: str(body.email),
    phone: str(body.phone),
    gender: str(body.gender) as Gender,
    ageRange: str(body.ageRange) as AgeRange,
    stateOfResidence: str(body.stateOfResidence),
    city: str(body.city),
    parishName: str(body.parishName),
  };
  const education: EducationAnswers = {
    educationLevel: str(body.educationLevel) as EducationLevel,
    currentStatus: str(body.currentStatus) as CurrentStatus,
  };
  const purposeClarity = typeof body.purposeClarity === 'number' ? body.purposeClarity : null;
  const consentVersion = str(body.consentVersion).trim();

  const fieldErrors: FieldErrors = {
    ...validatePersonal(personal),
    ...validateEducation(education),
    ...validatePurpose({ purposeClarity }),
  };
  if (!consentVersion || consentVersion.length > LIMITS.consentVersion.max) {
    fieldErrors.consentVersion = MESSAGES.consentRequired;
  }
  if (hasErrors(fieldErrors)) return { ok: false, fieldErrors };

  const parishName = collapseWhitespace(personal.parishName);
  return {
    ok: true,
    value: {
      fullName: collapseWhitespace(personal.fullName),
      email: normalizeEmail(personal.email),
      phoneE164: normalizePhone(personal.phone) as string,
      gender: personal.gender as Gender,
      ageRange: personal.ageRange as AgeRange,
      stateOfResidence: personal.stateOfResidence,
      city: collapseWhitespace(personal.city),
      parishName: parishName || null,
      educationLevel: education.educationLevel as EducationLevel,
      currentStatus: education.currentStatus as CurrentStatus,
      purposeClarity: purposeClarity as number,
      consentVersion,
      meta: sanitizeMeta(body.meta),
    },
  };
}
