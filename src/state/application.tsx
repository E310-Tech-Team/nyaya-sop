import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ApiError, getParish, getUnit } from '../lib/api';
import { readAttribution } from '../lib/attribution';
import { usePublicConfig, usePublicConfigStatus } from '../lib/config';
import { PLACE_LEVELS, parishAnswer, placeOfChain, recheck, recheckPlace, type ChosenPlace, type ParishDraft, type ProvinceDraft } from '../lib/parish';
import { readSession, writeSession } from '../lib/storage';
import {
  CONSENT_VERSION,
  isGender,
  type ApplicationPayload,
  type EducationAnswers,
  type FieldErrors,
  type PersonalAnswers,
  type PurposeAnswers,
  type SubmitApplicationResponse,
} from '../shared/application';
import { CHURCH_LEVELS, type ChainUnit, type ParishChain, type ParishDetailsResponse, type UnitDetails } from '../shared/directory';
import { MESSAGES, hasErrors, validateEducation, validateParish, validateParishText, validatePersonal, validatePurpose } from '../shared/validation';

export type Draft = {
  consent: boolean;
  personal: PersonalAnswers;
  education: EducationAnswers;
  purpose: PurposeAnswers;
  /** Honeypot value (should stay empty). */
  website: string;
  /** 'directory' while the parish question searches the RCCG list (set by the Personal step). */
  parishMode: 'text' | 'directory';
  /** Step 1 in directory mode (D-59): the province (or region or continent), or "I don't know my province". */
  province: ProvinceDraft | null;
  /** The parish answer in directory mode (the free text stays in personal.parishName). */
  parish: ParishDraft | null;
};

export type State = { draft: Draft; submission: SubmitApplicationResponse | null };

export type Action =
  | { type: 'consent'; value: boolean }
  | { type: 'personal'; value: Partial<PersonalAnswers> }
  | { type: 'education'; value: Partial<EducationAnswers> }
  | { type: 'purpose'; value: Partial<PurposeAnswers> }
  | { type: 'honeypot'; value: string }
  | { type: 'parishMode'; value: Draft['parishMode'] }
  | { type: 'province'; value: ProvinceDraft | null }
  | { type: 'parish'; value: ParishDraft | null }
  | { type: 'recheck'; id: string; current: ParishDetailsResponse | null }
  | { type: 'recheckProvince'; id: string; current: UnitDetails | null }
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
  parishMode: 'text',
  province: null,
  parish: null,
});

/** The same place, or both "I don't know my province". */
const samePlace = (a: ProvinceDraft | null, b: ProvinceDraft | null) =>
  a?.kind === 'place' && b?.kind === 'place' ? a.id === b.id : a?.kind === 'anywhere' && b?.kind === 'anywhere';

/** How the draft changes (exported for its tests). */
export function reducer(state: State, action: Action): State {
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
    case 'parishMode': {
      if (action.value === draft.parishMode) return state;
      // Switched off while answering: keep what they chose as free text.
      const chosen = draft.parish?.kind === 'listed' || draft.parish?.kind === 'not_listed' ? draft.parish.name : null;
      const personal = action.value === 'text' && chosen ? { ...draft.personal, parishName: chosen } : draft.personal;
      return { ...state, draft: { ...draft, personal, parishMode: action.value } };
    }
    case 'province':
      // Another place (or none): a parish chosen in the old one doesn't belong to it, so it goes too.
      return { ...state, draft: { ...draft, province: action.value, parish: samePlace(draft.province, action.value) ? draft.parish : null } };
    case 'parish':
      return { ...state, draft: { ...draft, parish: action.value } };
    case 'recheck': {
      // Only if the applicant hasn't chosen something else meanwhile.
      if (draft.parish?.kind !== 'listed' || draft.parish.id !== action.id) return state;
      const parish = recheck(draft.parish, action.current);
      // A parish the directory moved to another place takes the place with it.
      const chosen = draft.province?.kind === 'place' ? draft.province : null;
      const moved = parish.kind === 'listed' && chosen ? placeOfChain(parish.chain) : null;
      const province = moved && chosen && (moved.id !== chosen.id || moved.name !== chosen.name) ? moved : draft.province;
      return { ...state, draft: { ...draft, parish, province } };
    }
    case 'recheckProvince':
      if (draft.province?.kind !== 'place' || draft.province.id !== action.id) return state;
      return { ...state, draft: { ...draft, province: recheckPlace(draft.province, action.current) } };
    case 'submitted':
      // Keep the draft until the success page mounts (see clearDraft); clearing it here would
      // let the review page's step guard redirect before navigation to /apply/success lands.
      return { ...state, submission: action.value };
    case 'clearDraft':
      return { ...state, draft: emptyDraft() };
  }
}

/** A parish answer read back from storage, or null if it doesn't have the expected shape. */
function savedParish(value: unknown): ParishDraft | null {
  const parish = value as ParishDraft | null | undefined;
  if (parish?.kind === 'listed' && typeof parish.id === 'string' && typeof parish.name === 'string' && parish.chain) {
    // A look-alike count is a whole number above one, or absent.
    if (parish.lookalikes === undefined || (Number.isInteger(parish.lookalikes) && parish.lookalikes > 1)) return parish;
    const { lookalikes: _dropped, ...rest } = parish;
    return rest;
  }
  if (parish?.kind === 'not_listed' && typeof parish.name === 'string') return parish;
  if (parish?.kind === 'withdrawn' && typeof parish.name === 'string') return parish;
  return null;
}

/** A chain read back from storage: each level a unit with an ID and a name, or null. */
function savedChain(value: unknown): ParishChain | null {
  if (!value || typeof value !== 'object') return null;
  const chain = value as Record<string, unknown>;
  const unitOf = (unit: unknown): ChainUnit | null => {
    const { id, name } = (unit ?? {}) as Partial<ChainUnit>;
    return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
  };
  return Object.fromEntries(CHURCH_LEVELS.map((level) => [level, unitOf(chain[level])])) as ParishChain;
}

/**
 * The place read back from storage, or, from a draft saved before the province step (or without a
 * usable one), the place its parish belongs to: a listed parish's province, region or continent
 * (D-59), and for a parish reported as not listed, "I don't know my province", as it was answered.
 */
function savedProvince(value: unknown, parish: ParishDraft | null): ProvinceDraft | null {
  const province = value as Partial<ChosenPlace> | { kind?: unknown; name?: unknown } | null | undefined;
  if (province?.kind === 'place') {
    const { id, name, level } = province as Partial<ChosenPlace>;
    const chain = savedChain((province as Partial<ChosenPlace>).chain);
    if (typeof id === 'string' && typeof name === 'string' && (PLACE_LEVELS as readonly unknown[]).includes(level) && chain) {
      return { kind: 'place', id, name, level: level as ChosenPlace['level'], chain };
    }
  }
  if (province?.kind === 'anywhere') return { kind: 'anywhere' };
  if (province?.kind === 'withdrawn' && typeof province.name === 'string') return { kind: 'withdrawn', name: province.name };
  if (parish?.kind === 'listed') return placeOfChain(parish.chain);
  if (parish?.kind === 'not_listed') return { kind: 'anywhere' };
  return null;
}

/**
 * A draft read back from sessionStorage. Merged section by section so older or partial saved
 * drafts can't break the shape. A gender the form no longer offers ("Prefer not to say", saved
 * before 2026-09-30, or anything else) is cleared, keeping every other answer: the Personal step
 * then asks again, and the step guards send later steps back to it.
 */
export function restoreDraft(saved: Partial<Draft> | null): Draft {
  const base = emptyDraft();
  if (!saved) return base;
  const personal = { ...base.personal, ...saved.personal };
  const parish = savedParish(saved.parish);
  return {
    consent: saved.consent === true,
    personal: { ...personal, gender: isGender(personal.gender) ? personal.gender : '' },
    education: { ...base.education, ...saved.education },
    purpose: { ...base.purpose, ...saved.purpose },
    website: typeof saved.website === 'string' ? saved.website : '',
    parishMode: saved.parishMode === 'directory' ? 'directory' : 'text',
    province: savedProvince(saved.province, parish),
    parish,
  };
}

function initialState(): State {
  return {
    draft: restoreDraft(readSession<Partial<Draft>>(DRAFT_KEY)),
    submission: readSession<SubmitApplicationResponse>(SUBMISSION_KEY),
  };
}

/** The steps in order, with the route each lives at. */
export const STEPS = [
  { key: 'personal', path: '/apply/personal', label: 'Personal Information' },
  { key: 'education', path: '/apply/education', label: 'Education & Career' },
  { key: 'purpose', path: '/apply/purpose', label: 'Purpose & Self-Discovery' },
] as const;
export type StepKey = (typeof STEPS)[number]['key'] | 'review';

/**
 * The Personal step's errors. The parish question is compulsory: in directory mode a parish chosen
 * from the list and confirmed (or reported as not listed); otherwise its name. Typed text in the
 * directory's search box is never an answer. Its error names the step to do next: the province
 * (or "I don't know my province") first, then the parish.
 */
export function personalErrors(draft: Draft): FieldErrors {
  const errors = validatePersonal(draft.personal);
  delete errors.parishName;
  if (draft.parishMode === 'directory') {
    const answer = parishAnswer(draft.parish, draft.province);
    const placed = draft.province?.kind === 'place' || draft.province?.kind === 'anywhere';
    const checked = !answer && !placed ? ({ ok: false, error: MESSAGES.parishPlaceRequired } as const) : validateParish(answer, true);
    if (!checked.ok) errors.parishName = checked.error;
  } else {
    const checked = validateParishText(draft.personal.parishName);
    if (!checked.ok) errors.parishName = checked.error;
  }
  return errors;
}

/** The parish question the form asks: 'loading' or 'failed' until the server's settings arrive. */
export type ParishQuestion = 'loading' | 'failed' | Draft['parishMode'];

/**
 * Which parish question to ask, from the server's settings: the directory search while it's on,
 * otherwise the parish's name (docs/03). Every step keeps the draft in step with it, so a draft
 * started under the other setting is checked again (its steps reopen until it's answered).
 */
export function useParishQuestion(): ParishQuestion {
  const { setParishMode } = useApplication();
  const config = usePublicConfig();
  const status = usePublicConfigStatus();
  const directoryOn = config ? config.parishDirectory?.enabled === true : null;
  useEffect(() => {
    if (directoryOn !== null) setParishMode(directoryOn ? 'directory' : 'text');
  }, [directoryOn, setParishMode]);
  if (directoryOn === null) return status === 'failed' ? 'failed' : 'loading';
  return directoryOn ? 'directory' : 'text';
}

/**
 * The furthest route the applicant may open, given what they've completed.
 * Used to stop deep links from skipping consent or unanswered sections.
 */
export function firstIncompletePath(draft: Draft): string {
  if (!draft.consent) return '/apply';
  if (hasErrors(personalErrors(draft))) return '/apply/personal';
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
    // Only in directory mode: without it the server takes parishName as free text.
    ...(draft.parishMode === 'directory' ? { parish: parishAnswer(draft.parish, draft.province) } : {}),
  };
}

/** Where re-checking a saved parish stands: offline means it will be checked when back online. */
export type ParishCheck = 'idle' | 'checking' | 'offline' | 'done';

type ContextValue = {
  draft: Draft;
  submission: SubmitApplicationResponse | null;
  setConsent: (value: boolean) => void;
  updatePersonal: (value: Partial<PersonalAnswers>) => void;
  updateEducation: (value: Partial<EducationAnswers>) => void;
  updatePurpose: (value: Partial<PurposeAnswers>) => void;
  setHoneypot: (value: string) => void;
  setParishMode: (value: Draft['parishMode']) => void;
  /** Step 1 (D-59). `fresh`: just chosen from the search, so it needn't be checked again. Another place clears the parish. */
  setProvince: (value: ProvinceDraft | null, options?: { fresh?: boolean }) => void;
  /** `fresh`: just chosen from the search, so it needn't be checked again. */
  setParish: (value: ParishDraft | null, options?: { fresh?: boolean }) => void;
  parishCheck: ParishCheck;
  /** Check the chosen parish (and province) against the directory again (after the server rejected it). */
  recheckParish: () => void;
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
  const setParishMode = useCallback((value: Draft['parishMode']) => dispatch({ type: 'parishMode', value }), []);

  // A parish saved earlier may have been renamed, moved, merged or removed since: check it once
  // per page load (only when there is one, so other pages send nothing), and again when back online.
  const checked = useRef(new Set<string>());
  const [checkRun, setCheckRun] = useState(0);
  const [parishCheck, setParishCheck] = useState<ParishCheck>('idle');
  const listedId = state.draft.parish?.kind === 'listed' ? state.draft.parish.id : null;
  useEffect(() => {
    if (!listedId || checked.current.has(listedId)) return;
    const controller = new AbortController();
    const settle = (current: ParishDetailsResponse | null) => {
      checked.current.add(listedId);
      dispatch({ type: 'recheck', id: listedId, current });
      setParishCheck('done');
    };
    setParishCheck('checking');
    getParish(listedId, controller.signal).then(settle, (error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 404) settle(null);
      else setParishCheck('offline');
    });
    return () => controller.abort();
  }, [listedId, checkRun]);
  useEffect(() => {
    if (parishCheck !== 'offline') return;
    const retry = () => setCheckRun((run) => run + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [parishCheck]);

  // The province saved with the draft, the same way (D-59). A listed parish's check covers it
  // (its chain names the place), so only while there is none.
  const checkedPlaces = useRef(new Set<string>());
  const [placeOffline, setPlaceOffline] = useState(false);
  const placeId = state.draft.province?.kind === 'place' && state.draft.parish?.kind !== 'listed' ? state.draft.province.id : null;
  useEffect(() => {
    if (!placeId || checkedPlaces.current.has(placeId)) return;
    const controller = new AbortController();
    const settle = (current: UnitDetails | null) => {
      checkedPlaces.current.add(placeId);
      dispatch({ type: 'recheckProvince', id: placeId, current });
      setPlaceOffline(false);
    };
    getUnit(placeId, controller.signal).then(settle, (error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 404) settle(null);
      else setPlaceOffline(true);
    });
    return () => controller.abort();
  }, [placeId, checkRun]);
  useEffect(() => {
    if (!placeOffline) return;
    const retry = () => setCheckRun((run) => run + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [placeOffline]);

  const setProvince = useCallback((value: ProvinceDraft | null, options?: { fresh?: boolean }) => {
    if (options?.fresh && value?.kind === 'place') checkedPlaces.current.add(value.id);
    dispatch({ type: 'province', value });
  }, []);
  const setParish = useCallback((value: ParishDraft | null, options?: { fresh?: boolean }) => {
    if (options?.fresh && value?.kind === 'listed') checked.current.add(value.id);
    dispatch({ type: 'parish', value });
  }, []);
  const recheckParish = useCallback(() => {
    checked.current.clear();
    checkedPlaces.current.clear();
    setCheckRun((run) => run + 1);
  }, []);
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
      setParishMode,
      setProvince,
      setParish,
      parishCheck,
      recheckParish,
      markSubmitted,
      clearDraft,
    }),
    [state, setConsent, updatePersonal, updateEducation, updatePurpose, setHoneypot, setParishMode, setProvince, setParish, parishCheck, recheckParish, markSubmitted, clearDraft],
  );

  return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>;
}

export function useApplication(): ContextValue {
  const context = useContext(ApplicationContext);
  if (!context) throw new Error('useApplication must be used inside <ApplicationProvider>');
  return context;
}
