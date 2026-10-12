import { cleanText, characters, isValidEmail, normalizeEmail, normalizePhone } from './validation';

export const MENTOR_AGE_RANGES = [
  { value: '18_24', label: '18–24' },
  { value: '25_29', label: '25–29' },
  { value: '30_39', label: '30–39' },
  { value: '40_49', label: '40–49' },
  { value: '50_59', label: '50–59' },
  { value: '60_plus', label: '60+' },
] as const;

export const EARLIER_MENTOR_AGE_RANGES = [{ value: '18_29', label: '18–29 (earlier form)' }] as const;
export const STORED_MENTOR_AGE_RANGES = [...MENTOR_AGE_RANGES, ...EARLIER_MENTOR_AGE_RANGES] as const;

export const PILLAR_FITS = [
  { value: 'ministry_church_leadership', label: 'Ministry & Church Leadership' },
  { value: 'family_social_development', label: 'Family & Social Development' },
  { value: 'education_academia', label: 'Education & Academia' },
  { value: 'business_finance_entrepreneurship', label: 'Business, Finance & Entrepreneurship' },
  { value: 'politics_governance_public_service', label: 'Politics, Governance & Public Service' },
  { value: 'media_communications', label: 'Media & Communications' },
  { value: 'technology_innovation', label: 'Technology & Innovation' },
  { value: 'creative_arts_entertainment', label: 'Creative Arts & Entertainment' },
] as const;

export const RCCG_STATUSES = [
  { value: 'rccg_member', label: 'RCCG member' },
  { value: 'non_rccg', label: 'Non-RCCG' },
] as const;

export type MentorAgeRange = (typeof MENTOR_AGE_RANGES)[number]['value'];
export type StoredMentorAgeRange = (typeof STORED_MENTOR_AGE_RANGES)[number]['value'];
export type PillarFit = (typeof PILLAR_FITS)[number]['value'];
export type RccgStatus = (typeof RCCG_STATUSES)[number]['value'];

export function labelsForPillarFits(values: readonly string[]): string[] {
  return values.map((value) => PILLAR_FITS.find((option) => option.value === value)?.label ?? value);
}

export type MentorNominationField =
  | 'nominatorName'
  | 'nomineeName'
  | 'regionLocation'
  | 'nomineePhone'
  | 'nomineeEmail'
  | 'ageRange'
  | 'jobRole'
  | 'experience'
  | 'pillarFit'
  | 'rccgStatus'
  | 'whyFit'
  | 'testimonial'
  | 'socialProfile';

export type MentorNominationAnswers = {
  nominatorName: string;
  nomineeName: string;
  regionLocation: string;
  nomineePhone: string;
  nomineeEmail: string;
  ageRange: string;
  jobRole: string;
  experience: string;
  pillarFit: string[];
  rccgStatus: string;
  whyFit: string;
  testimonial: string;
  socialProfile: string;
};

export type MentorNominationPayload = MentorNominationAnswers & { website?: string };

export type NormalizedMentorNomination = {
  nominatorName: string;
  nomineeName: string;
  regionLocation: string;
  nomineePhoneE164: string;
  nomineeEmail: string;
  ageRange: MentorAgeRange;
  jobRole: string;
  experience: string;
  pillarFit: string[];
  rccgStatus: RccgStatus;
  whyFit: string;
  testimonial: string;
  socialProfile: string | null;
};

export type MentorNominationFieldErrors = Partial<Record<MentorNominationField, string>>;

export type MentorNominationValidation =
  | { ok: true; value: NormalizedMentorNomination }
  | { ok: false; fieldErrors: MentorNominationFieldErrors };

const AGE_RANGE_VALUES: readonly string[] = MENTOR_AGE_RANGES.map(({ value }) => value);
const PILLAR_FIT_VALUES: readonly string[] = PILLAR_FITS.map(({ value }) => value);
const RCCG_STATUS_VALUES: readonly string[] = RCCG_STATUSES.map(({ value }) => value);
const hasLetter = /\p{L}/u;
const stringValue = (value: unknown) => (typeof value === 'string' ? value : '');

const TEXT_LIMITS = {
  name: 120,
  regionLocation: 120,
  jobRole: 120,
  experience: 1200,
  pillarFit: 300,
  whyFit: 1500,
  testimonial: 1500,
  socialProfile: 300,
} as const;

/** Validates an untrusted nomination body and returns the exact values safe to persist. */
export function validateMentorNomination(input: unknown): MentorNominationValidation {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const fields: MentorNominationAnswers = {
    nominatorName: stringValue(body.nominatorName),
    nomineeName: stringValue(body.nomineeName),
    regionLocation: stringValue(body.regionLocation),
    nomineePhone: stringValue(body.nomineePhone),
    nomineeEmail: stringValue(body.nomineeEmail),
    ageRange: stringValue(body.ageRange),
    jobRole: stringValue(body.jobRole),
    experience: stringValue(body.experience),
    pillarFit: Array.isArray(body.pillarFit) ? body.pillarFit.filter((value): value is string => typeof value === 'string') : [],
    rccgStatus: stringValue(body.rccgStatus),
    whyFit: stringValue(body.whyFit),
    testimonial: stringValue(body.testimonial),
    socialProfile: stringValue(body.socialProfile),
  };
  const clean = {
    nominatorName: cleanText(fields.nominatorName),
    nomineeName: cleanText(fields.nomineeName),
    regionLocation: cleanText(fields.regionLocation),
    jobRole: cleanText(fields.jobRole),
    experience: cleanText(fields.experience),
    pillarFit: fields.pillarFit.map(cleanText),
    whyFit: cleanText(fields.whyFit),
    testimonial: cleanText(fields.testimonial),
    socialProfile: cleanText(fields.socialProfile),
  };
  const fieldErrors: MentorNominationFieldErrors = {};

  for (const field of ['nominatorName', 'nomineeName'] as const) {
    const value = clean[field];
    if (characters(value) < 2 || !hasLetter.test(value)) fieldErrors[field] = 'Enter a name with at least two characters.';
    else if (characters(value) > TEXT_LIMITS.name) fieldErrors[field] = 'Names must be 120 characters or fewer.';
  }

  if (characters(clean.regionLocation) < 2 || characters(clean.regionLocation) > TEXT_LIMITS.regionLocation) {
    fieldErrors.regionLocation = 'Enter a region, base or location (up to 120 characters).';
  }

  const phone = normalizePhone(fields.nomineePhone);
  if (!fields.nomineePhone.trim()) fieldErrors.nomineePhone = 'Enter the nominee’s phone number.';
  else if (!phone) fieldErrors.nomineePhone = 'Enter a valid phone number, including the country code if needed.';

  if (!fields.nomineeEmail.trim()) fieldErrors.nomineeEmail = 'Enter the nominee’s email address.';
  else if (!isValidEmail(fields.nomineeEmail)) fieldErrors.nomineeEmail = 'Enter a valid email address.';

  if (!AGE_RANGE_VALUES.includes(fields.ageRange)) fieldErrors.ageRange = 'Select the nominee’s age range.';
  if (characters(clean.jobRole) < 2 || characters(clean.jobRole) > TEXT_LIMITS.jobRole) {
    fieldErrors.jobRole = 'Enter the nominee’s job role or profession (up to 120 characters).';
  }
  if (characters(clean.experience) < 2 || characters(clean.experience) > TEXT_LIMITS.experience) {
    fieldErrors.experience = 'Describe the nominee’s experience (up to 1,200 characters).';
  }
  const legacyPillarFit = typeof body.pillarFit === 'string' ? cleanText(body.pillarFit) : '';
  const pillarValues = clean.pillarFit;
  const hasValidPillars =
    pillarValues.length > 0 &&
    pillarValues.length <= PILLAR_FITS.length &&
    pillarValues.every((value) => PILLAR_FIT_VALUES.includes(value)) &&
    new Set(pillarValues).size === pillarValues.length;
  if (!hasValidPillars && !(legacyPillarFit.length >= 2 && characters(legacyPillarFit) <= TEXT_LIMITS.pillarFit)) {
    fieldErrors.pillarFit = 'Select at least one pillar (up to eight).';
  }
  if (!RCCG_STATUS_VALUES.includes(fields.rccgStatus)) {
    fieldErrors.rccgStatus = 'Select the nominee’s RCCG status.';
  }
  if (characters(clean.whyFit) < 20 || characters(clean.whyFit) > TEXT_LIMITS.whyFit) {
    fieldErrors.whyFit = 'Explain why the nominee is a good fit (20–1,500 characters).';
  }
  if (characters(clean.testimonial) < 10 || characters(clean.testimonial) > TEXT_LIMITS.testimonial) {
    fieldErrors.testimonial = 'Enter a short testimonial (10–1,500 characters).';
  }
  if (characters(clean.socialProfile) > TEXT_LIMITS.socialProfile) {
    fieldErrors.socialProfile = 'The social media profile must be 300 characters or fewer.';
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    value: {
      ...clean,
      pillarFit: hasValidPillars ? pillarValues : [legacyPillarFit],
      nomineePhoneE164: phone!,
      nomineeEmail: normalizeEmail(fields.nomineeEmail),
      ageRange: fields.ageRange as MentorAgeRange,
      rccgStatus: fields.rccgStatus as RccgStatus,
      socialProfile: clean.socialProfile || null,
    },
  };
}
