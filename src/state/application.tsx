import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { readAttribution } from '../lib/attribution';
import { readSession, writeSession } from '../lib/storage';
import {
  CONSENT_VERSION,
  type ApplicationPayload,
  type EducationAnswers,
  type PersonalAnswers,
  type PurposeAnswers,
  type SubmitApplicationResponse,
} from '../shared/application';
import { hasErrors, validateEducation, validatePersonal, validatePurpose } from '../shared/validation';

export type Draft = {
  consent: boolean;
  personal: PersonalAnswers;
  education: EducationAnswers;
  purpose: PurposeAnswers;
  /** Honeypot value (should stay empty). */
  website: string;
};

type State = { draft: Draft; submission: SubmitApplicationResponse | null };

type Action =
  | { type: 'consent'; value: boolean }
  | { type: 'personal'; value: Partial<PersonalAnswers> }
  | { type: 'education'; value: Partial<EducationAnswers> }
  | { type: 'purpose'; value: Partial<PurposeAnswers> }
  | { type: 'honeypot'; value: string }
  | { type: 'submitted'; value: SubmitApplicationResponse }
  | { type: 'clearDraft' };

const DRAFT_KEY = 'sop.application.draft.v1';
const SUBMISSION_KEY = 'sop.application.submission.v1';

export const emptyDraft = (): Draft => ({
  consent: false,
  personal: {
    fullName: '',
    email: '',
    phone: '',
    gender: '',
    ageRange: '',
    stateOfResidence: '',
    city: '',
    parishName: '',
  },
  education: { educationLevel: '', currentStatus: '' },
  purpose: { purposeClarity: null },
  website: '',
});

function reducer(state: State, action: Action): State {
  const { draft } = state;
  switch (action.type) {
    case 'consent':
      return { ...state, draft: { ...draft, consent: action.value } };
    case 'personal':
      return { ...state, draft: { ...draft, personal: { ...draft.personal, ...action.value } } };
    case 'education':
      return { ...state, draft: { ...draft, education: { ...draft.education, ...action.value } } };
    case 'purpose':
      return { ...state, draft: { ...draft, purpose: { ...draft.purpose, ...action.value } } };
    case 'honeypot':
      return { ...state, draft: { ...draft, website: action.value } };
    case 'submitted':
      // Keep the draft until the success page mounts (see clearDraft); clearing it here would
      // let the review page's step guard redirect before navigation to /apply/success lands.
      return { ...state, submission: action.value };
    case 'clearDraft':
      return { ...state, draft: emptyDraft() };
  }
}

function initialState(): State {
  const saved = readSession<Partial<Draft>>(DRAFT_KEY);
  const base = emptyDraft();
  // Merge section by section so older/partial saved drafts can't break the shape.
  const draft: Draft = saved
    ? {
        consent: saved.consent === true,
        personal: { ...base.personal, ...saved.personal },
        education: { ...base.education, ...saved.education },
        purpose: { ...base.purpose, ...saved.purpose },
        website: typeof saved.website === 'string' ? saved.website : '',
      }
    : base;
  return { draft, submission: readSession<SubmitApplicationResponse>(SUBMISSION_KEY) };
}

/** The steps in order, with the route each lives at. */
export const STEPS = [
  { key: 'personal', path: '/apply/personal', label: 'Personal Information' },
  { key: 'education', path: '/apply/education', label: 'Education & Career' },
  { key: 'purpose', path: '/apply/purpose', label: 'Purpose & Self-Discovery' },
] as const;
export type StepKey = (typeof STEPS)[number]['key'] | 'review';

/**
 * The furthest route the applicant may open, given what they've completed.
 * Used to stop deep links from skipping consent or unanswered sections.
 */
export function firstIncompletePath(draft: Draft): string {
  if (!draft.consent) return '/apply';
  if (hasErrors(validatePersonal(draft.personal))) return '/apply/personal';
  if (hasErrors(validateEducation(draft.education))) return '/apply/education';
  if (hasErrors(validatePurpose(draft.purpose))) return '/apply/purpose';
  return '/apply/review';
}

const ORDER = ['/apply', '/apply/personal', '/apply/education', '/apply/purpose', '/apply/review'];
export const isReachable = (draft: Draft, path: string) =>
  ORDER.indexOf(path) <= ORDER.indexOf(firstIncompletePath(draft));

export function toPayload(draft: Draft): ApplicationPayload {
  return {
    ...draft.personal,
    ...draft.education,
    ...draft.purpose,
    consentVersion: CONSENT_VERSION,
    website: draft.website,
    meta: readAttribution(),
  };
}

type ContextValue = {
  draft: Draft;
  submission: SubmitApplicationResponse | null;
  setConsent: (value: boolean) => void;
  updatePersonal: (value: Partial<PersonalAnswers>) => void;
  updateEducation: (value: Partial<EducationAnswers>) => void;
  updatePurpose: (value: Partial<PurposeAnswers>) => void;
  setHoneypot: (value: string) => void;
  markSubmitted: (value: SubmitApplicationResponse) => void;
  /** Forget the answers (after a confirmed submission); the submission receipt is kept. */
  clearDraft: () => void;
};

const ApplicationContext = createContext<ContextValue | null>(null);

export function ApplicationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => writeSession(DRAFT_KEY, state.draft), [state.draft]);
  useEffect(() => writeSession(SUBMISSION_KEY, state.submission), [state.submission]);

  const setConsent = useCallback((value: boolean) => dispatch({ type: 'consent', value }), []);
  const updatePersonal = useCallback((value: Partial<PersonalAnswers>) => dispatch({ type: 'personal', value }), []);
  const updateEducation = useCallback((value: Partial<EducationAnswers>) => dispatch({ type: 'education', value }), []);
  const updatePurpose = useCallback((value: Partial<PurposeAnswers>) => dispatch({ type: 'purpose', value }), []);
  const setHoneypot = useCallback((value: string) => dispatch({ type: 'honeypot', value }), []);
  const markSubmitted = useCallback((value: SubmitApplicationResponse) => dispatch({ type: 'submitted', value }), []);
  const clearDraft = useCallback(() => dispatch({ type: 'clearDraft' }), []);

  const value = useMemo<ContextValue>(
    () => ({
      draft: state.draft,
      submission: state.submission,
      setConsent,
      updatePersonal,
      updateEducation,
      updatePurpose,
      setHoneypot,
      markSubmitted,
      clearDraft,
    }),
    [state, setConsent, updatePersonal, updateEducation, updatePurpose, setHoneypot, markSubmitted, clearDraft],
  );

  return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>;
}

export function useApplication(): ContextValue {
  const context = useContext(ApplicationContext);
  if (!context) throw new Error('useApplication must be used inside <ApplicationProvider>');
  return context;
}
