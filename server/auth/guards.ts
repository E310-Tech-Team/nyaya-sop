/**
 * Route guards. Every admin and account route declares one; nothing is protected by the
 * frontend alone. Order: session → account status → origin + CSRF (for changes) → second
 * factor → permission.
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { can, isStaffRole, type Permission, type StaffRole } from '../../src/shared/permissions';
import { isAllowedOrigin, isUnsafeMethod, sendError } from '../http';
import type { Services } from '../services';
import {
  clearSessionCookie,
  hasValidCsrf,
  loadApplicantSession,
  loadStaffSession,
  readSessionToken,
  revokeApplicantSessions,
  revokeStaffSessions,
} from './sessions';

export type StaffContext = {
  sessionId: string;
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  mfaAttempts: number;
};

export type AccountContext = { sessionId: string; id: string; email: string; createdAt: Date };

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffContext;
    account?: AccountContext;
  }
}

/** Refuses a state-changing request from anywhere but our own pages. */
export function checkOrigin(services: Services, request: FastifyRequest, reply: FastifyReply): boolean {
  if (!isUnsafeMethod(request.method) || isAllowedOrigin(request, services.config)) return true;
  sendError(reply, 403, 'INVALID_ORIGIN', 'This request did not come from the School of Purpose site.');
  return false;
}

type StaffGuardOptions = {
  /** Any one of these is enough. */
  permission?: Permission | Permission[];
  /** Signed in with a password, second factor not yet checked (the MFA step itself). */
  allowPendingMfa?: boolean;
  /** Allowed before a required second factor is set up (enrolment, own session, sign-out). */
  allowWithoutMfaSetup?: boolean;
};

export function staffGuard(services: Services, options: StaffGuardOptions = {}): preHandlerAsyncHookHandler {
  const { config, db, secrets } = services;
  return async (request, reply) => {
    const token = readSessionToken(request, 'staff', config);
    const session = token ? await loadStaffSession(db, token, config.auth.staffIdleMinutes) : null;
    if (!session) {
      if (token) clearSessionCookie(reply, 'staff', config);
      return sendError(reply, 401, 'UNAUTHORIZED', 'Please sign in to the admin area.');
    }
    if (session.status !== 'active' || !isStaffRole(session.role)) {
      await revokeStaffSessions(db, session.staff_id);
      clearSessionCookie(reply, 'staff', config);
      return sendError(reply, 401, 'UNAUTHORIZED', 'This staff account is not active.');
    }
    if (isUnsafeMethod(request.method)) {
      if (!checkOrigin(services, request, reply)) return reply;
      if (!hasValidCsrf(request, secrets, 'staff', session.session_id)) {
        return sendError(reply, 403, 'FORBIDDEN', 'Your session token is missing or out of date. Reload the page and try again.');
      }
    }
    const mfaEnabled = Boolean(session.mfa_enabled_at);
    const mfaVerified = Boolean(session.mfa_verified_at);
    if (mfaEnabled && !mfaVerified && !options.allowPendingMfa) {
      return sendError(reply, 401, 'MFA_REQUIRED', 'Enter your verification code to continue.');
    }
    if (!mfaEnabled && config.auth.staffMfaRequired && !options.allowWithoutMfaSetup) {
      return sendError(reply, 403, 'MFA_SETUP_REQUIRED', 'Set up two-step verification to use the admin area.');
    }
    const permissions = options.permission === undefined ? [] : [options.permission].flat();
    if (permissions.length && !permissions.some((permission) => can(session.role as StaffRole, permission))) {
      return sendError(reply, 403, 'FORBIDDEN', 'Your role does not allow this.');
    }
    request.staff = {
      sessionId: session.session_id,
      id: session.staff_id,
      email: session.email,
      displayName: session.display_name,
      role: session.role as StaffRole,
      mfaEnabled,
      mfaVerified,
      mfaAttempts: session.mfa_attempts,
    };
  };
}

export function accountGuard(services: Services): preHandlerAsyncHookHandler {
  const { config, db, secrets } = services;
  return async (request, reply) => {
    const token = readSessionToken(request, 'applicant', config);
    const session = token ? await loadApplicantSession(db, token, config.auth.applicantIdleDays) : null;
    if (!session) {
      if (token) clearSessionCookie(reply, 'applicant', config);
      return sendError(reply, 401, 'UNAUTHORIZED', 'Please sign in to your account.');
    }
    if (session.status !== 'active') {
      await revokeApplicantSessions(db, session.account_id);
      clearSessionCookie(reply, 'applicant', config);
      return sendError(reply, 403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact the Programme team if you think this is a mistake.');
    }
    if (isUnsafeMethod(request.method)) {
      if (!checkOrigin(services, request, reply)) return reply;
      if (!hasValidCsrf(request, secrets, 'applicant', session.session_id)) {
        return sendError(reply, 403, 'FORBIDDEN', 'Your session token is missing or out of date. Reload the page and try again.');
      }
    }
    request.account = { sessionId: session.session_id, id: session.account_id, email: session.email, createdAt: session.created_at };
  };
}

/** Loads the applicant session when there is one, without requiring it (e.g. push subscribe). */
export async function optionalAccount(services: Services, request: FastifyRequest): Promise<AccountContext | null> {
  const token = readSessionToken(request, 'applicant', services.config);
  if (!token) return null;
  const session = await loadApplicantSession(services.db, token, services.config.auth.applicantIdleDays);
  if (!session || session.status !== 'active') return null;
  if (isUnsafeMethod(request.method) && !hasValidCsrf(request, services.secrets, 'applicant', session.session_id)) return null;
  return { sessionId: session.session_id, id: session.account_id, email: session.email, createdAt: session.created_at };
}
