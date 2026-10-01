import type {
  ApiErrorBody,
  ApiErrorCode,
  ApplicationPayload,
  CurrentCohortResponse,
  FieldErrors,
  SubmitApplicationResponse,
} from '../shared/application';
import type { ParishDetailsResponse, ParishSearchResponse, UnitDetails, UnitSearchResponse } from '../shared/directory';
import { noteServerBuild } from './pwa';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'TIMEOUT',
    message: string,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const apiUrl = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api${path}`;

/** Which signed-in area a request belongs to: its CSRF token (from sign-in) is sent with changes. */
export type CsrfScope = 'applicant' | 'staff';
const csrfTokens: Partial<Record<CsrfScope, string>> = {};
export function setCsrfToken(scope: CsrfScope, token: string | null | undefined): void {
  if (token) csrfTokens[scope] = token;
  else delete csrfTokens[scope];
}

export type RequestOptions = Omit<RequestInit, 'body'> & { timeoutMs?: number; csrf?: CsrfScope; json?: unknown };

export async function apiRequest<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 20_000, csrf, json, ...rest } = init;
  const token = csrf ? csrfTokens[csrf] : undefined;
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...rest,
      credentials: 'same-origin',
      body: json === undefined ? undefined : JSON.stringify(json),
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'x-csrf-token': token } : {}),
      },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError' && rest.signal?.aborted) throw error; // caller cancelled
    if ((error as Error).name === 'TimeoutError') {
      throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond.');
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.');
  }
  noteServerBuild(response.headers.get('x-app-build'));

  const body = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!response.ok) {
    const code = body?.code ?? (response.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR');
    throw new ApiError(response.status, code, body?.message ?? response.statusText, body?.fieldErrors);
  }
  return body as T;
}

export const getCurrentCohort = (signal?: AbortSignal) =>
  apiRequest<CurrentCohortResponse>('/cohorts/current', { signal, timeoutMs: 8_000 });

export const submitApplication = (payload: ApplicationPayload) =>
  apiRequest<SubmitApplicationResponse>('/applications', { method: 'POST', json: payload });

/** Suggestions for the parish question; `state` only ranks them (parishes there come first). */
export const searchParishes = (query: string, state: string | null, signal: AbortSignal) =>
  apiRequest<ParishSearchResponse>(`/parishes/search?${new URLSearchParams(state ? { q: query, state } : { q: query })}`, { signal });

/** One parish as it stands now, to re-check a choice saved earlier. */
export const getParish = (id: string, signal?: AbortSignal) =>
  apiRequest<ParishDetailsResponse>(`/parishes/${encodeURIComponent(id)}`, { signal, timeoutMs: 8_000 });

/**
 * Step 1 of the parish question (D-59): provinces, and the regions and continents with parishes in
 * no province, by name or number. `state` only ranks them; `offset` pages through them.
 */
export const searchUnits = (query: string, state: string | null, offset: number, signal: AbortSignal) =>
  apiRequest<UnitSearchResponse>(
    `/parishes/units?${new URLSearchParams({ q: query, ...(state ? { state } : {}), ...(offset ? { offset: String(offset) } : {}) })}`,
    { signal },
  );

/** Step 2: one place's parishes, those matching `query` or all of them (when empty), from `offset`. */
export const searchPlaceParishes = (unit: string, query: string, offset: number, signal: AbortSignal) =>
  apiRequest<ParishSearchResponse>(`/parishes/search?${new URLSearchParams({ unit, q: query, ...(offset ? { offset: String(offset) } : {}) })}`, { signal });

/** A province (or region or continent) as it stands now, to re-check one saved earlier. */
export const getUnit = (id: string, signal?: AbortSignal) =>
  apiRequest<UnitDetails>(`/parishes/units/${encodeURIComponent(id)}`, { signal, timeoutMs: 8_000 });
