/**
 * The expression-of-interest domain, shared by the browser app and the API server.
 * Keep this module free of DOM, React and Node imports.
 *
 * The `value`s below are stored in Postgres enums (server/migrations/0001_init.sql);
 * change both together. The `gender` enum is `STORED_GENDERS`: today's options plus an
 * earlier one that stored applications keep (migration 0011).
 */

export const CONSENT_VERSION = '2026-09-v1';
export const CONSENT_STATEMENT =
  'I confirm that I am an RCCG member aged 18-30 and consent to being contacted about this programme.';

/** The gender options applicants choose from: the form's select and the shared validation. */
export const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const;

/**
 * Answers the form offered once and no longer does. "Prefer not to say" was an option until
 * 2026-09-30 (docs/06 D-54): applications saved with it keep it, so staff screens and exports
 * still label it, but nobody can choose it again (the validation, and migration 0011's trigger).
 */
export const EARLIER_GENDERS = [{ value: 'prefer_not_to_say', label: 'Prefer not to say (earlier form)' }] as const;

/** Every value the `gender` enum holds, in its order: for labelling stored applications. */
export const STORED_GENDERS = [...GENDERS, ...EARLIER_GENDERS] as const;

export const AGE_RANGES = [
  { value: '18_20', label: '18-20' },
  { value: '21_24', label: '21-24' },
  { value: '25_27', label: '25-27' },
  { value: '28_30', label: '28-30' },
] as const;

export const EDUCATION_LEVELS = [
  { value: 'secondary_school', label: 'Secondary School' },
  { value: 'ond_nce', label: 'OND/NCE' },
  { value: 'hnd', label: 'HND' },
  { value: 'bachelors', label: "Bachelor's Degree" },
  { value: 'masters', label: "Master's Degree" },
] as const;

export const CURRENT_STATUSES = [
  { value: 'student', label: 'Student' },
  { value: 'nysc', label: 'NYSC' },
  { value: 'employed', label: 'Employed' },
  { value: 'entrepreneur', label: 'Entrepreneur/Business Owner' },
  { value: 'freelancer', label: 'Freelancer' },
  { value: 'job_seeker', label: 'Job seeker' },
  { value: 'recent_graduate', label: 'Recent graduate' },
  { value: 'other', label: 'Other' },
] as const;

export const PURPOSE_SCALE = [
  { value: 1, label: 'Not clear at all' },
  { value: 2, label: 'Slightly clear' },
  { value: 3, label: 'Somewhat clear' },
  { value: 4, label: 'Very clear' },
  { value: 5, label: 'Extremely clear' },
] as const;

/** The 36 states plus the FCT, alphabetical. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
] as const;
export const OUTSIDE_NIGERIA = 'Outside Nigeria';
export const STATE_OPTIONS: readonly string[] = [...NIGERIAN_STATES, OUTSIDE_NIGERIA];

/** A gender an applicant can choose today. */
export type Gender = (typeof GENDERS)[number]['value'];
/** A gender as stored: one of today's options, or an earlier one (read-only). */
export type StoredGender = (typeof STORED_GENDERS)[number]['value'];
export type AgeRange = (typeof AGE_RANGES)[number]['value'];
export type EducationLevel = (typeof EDUCATION_LEVELS)[number]['value'];
export type CurrentStatus = (typeof CURRENT_STATUSES)[number]['value'];

/** True for a gender applicants can choose today; false for an earlier answer, '' or anything else. */
export const isGender = (value: unknown): value is Gender => GENDERS.some((option) => option.value === value);

/** Section 1, as typed by the applicant (not yet normalised). */
export type PersonalAnswers = {
  fullName: string;
  email: string;
  phone: string;
  gender: Gender | '';
  ageRange: AgeRange | '';
  stateOfResidence: string;
  city: string;
  parishName: string;
};

/** Section 2. */
export type EducationAnswers = {
  educationLevel: EducationLevel | '';
  currentStatus: CurrentStatus | '';
};

/** Section 3. */
export type PurposeAnswers = {
  purposeClarity: number | null;
};

/** Where the applicant came from (UTM tags + referring site), for outreach reporting. */
export type SubmissionMeta = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
};

/**
 * The parish answer when the form uses the parish directory: a listed parish the applicant
 * confirmed, or one they couldn't find (the name as they know it). Older copies of the form
 * send only `parishName`, as free text.
 */
export type ParishAnswer =
  | { kind: 'listed'; id: string; confirmed: boolean; detailsWrong?: boolean }
  /** `unitId`: the province (or region or continent) they chose before saying it isn't listed (D-59). */
  | { kind: 'not_listed'; name: string; unitId?: string };

/** The parish answer after validation. */
export type ParishChoice =
  | { kind: 'listed'; parishId: string; detailsWrong: boolean }
  | { kind: 'not_listed'; name: string; unitId?: string }
  /**
   * The free-text question, used only while the directory is off (then the name is required).
   * `null` exists only on applications stored before the parish became compulsory.
   */
  | { kind: 'typed'; name: string | null };

/** JSON body of `POST /api/applications`. */
export type ApplicationPayload = PersonalAnswers &
  EducationAnswers &
  PurposeAnswers & {
    consentVersion: string;
    /** Honeypot. Hidden from people; bots that fill every field give themselves away. */
    website?: string;
    meta?: SubmissionMeta;
    /** Present when the form uses the parish directory (then it replaces `parishName`). */
    parish?: ParishAnswer | null;
  };

/** A payload after validation + normalisation: what the server stores. */
export type NormalizedApplication = {
  fullName: string;
  email: string;
  phoneE164: string;
  gender: Gender;
  ageRange: AgeRange;
  stateOfResidence: string;
  city: string;
  parish: ParishChoice;
  educationLevel: EducationLevel;
  currentStatus: CurrentStatus;
  purposeClarity: number;
  consentVersion: string;
  meta: SubmissionMeta;
};

export type ApplicationField =
  | keyof PersonalAnswers
  | keyof EducationAnswers
  | keyof PurposeAnswers
  | 'consentVersion';

export type FieldErrors = Partial<Record<ApplicationField, string>>;

export type SubmitApplicationResponse = {
  id: string;
  reference: string;
  submittedAt: string;
};

export type CurrentCohortResponse = {
  cohort: null | {
    slug: string;
    name: string;
    edition: number;
    isAcceptingApplications: boolean;
    applicationsCloseAt: string | null;
  };
};

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  /** The RCCG directory couldn't confirm the chosen parish just now: nothing was stored; try again. */
  | 'DIRECTORY_UNAVAILABLE'
  | 'ALREADY_APPLIED'
  | 'APPLICATIONS_CLOSED'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GONE'
  | 'INVALID_ORIGIN'
  | 'INVALID_TOKEN'
  | 'MFA_REQUIRED'
  | 'MFA_SETUP_REQUIRED'
  /** A security change (a sign-in method, recovery codes) needs a recent check: confirm it's you first. */
  | 'STEP_UP_REQUIRED'
  /** Removing this would leave no way through two-step verification while it's required. */
  | 'LAST_METHOD'
  /** The reset link's account has no passkey to confirm it with. */
  | 'NO_PASSKEY'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNTS_UNAVAILABLE'
  | 'PUSH_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  code: ApiErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
};

export function labelFor(
  options: readonly { readonly value: unknown; readonly label: string }[],
  value: unknown,
): string {
  return options.find((option) => option.value === value)?.label ?? '';
}

/** +2348012345678 → "0801 234 5678" (how Nigerians write it); other countries stay in E.164. */
export function formatPhone(e164: string): string {
  const match = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : e164;
}

/** Short, human-friendly reference shown to applicants, derived from the row id. */
export function referenceFromId(id: string): string {
  return `SOP-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
