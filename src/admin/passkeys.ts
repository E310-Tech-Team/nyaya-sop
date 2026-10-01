/**
 * Passkeys in the browser (@simplewebauthn/browser), for the admin area only: public pages never
 * load this library (src/components/ui/bundles.test.ts). Options are fetched before the click, and
 * the ceremony starts first thing in the click handler (Safari's user-gesture rule).
 */
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON };

/** Whether this browser can use passkeys at all (feature detection, never the user agent). */
export const passkeysSupported = (): boolean => browserSupportsWebAuthn();

/** A passkey prompt that didn't give an answer, with words for the person (shown as they are). */
export class PasskeyProblem extends Error {}

/** The person closed the passkey prompt or it timed out: nothing went wrong. */
export class PasskeyCancelled extends PasskeyProblem {}

function explain(error: unknown): PasskeyProblem {
  if (error instanceof WebAuthnError) {
    if (error.code === 'ERROR_CEREMONY_ABORTED' || (error.cause as Error | undefined)?.name === 'NotAllowedError') {
      return new PasskeyCancelled('The passkey prompt was closed or timed out. Try again when you’re ready.');
    }
    if (error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return new PasskeyProblem('This device already has a passkey for your account.');
    if (error.code === 'ERROR_INVALID_DOMAIN' || error.code === 'ERROR_INVALID_RP_ID') return new PasskeyProblem('Passkeys can’t be used on this web address.');
    if (error.code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT') {
      return new PasskeyProblem('This passkey can’t check it’s you (no fingerprint, face or PIN). Use another device.');
    }
  }
  return new PasskeyProblem('The passkey didn’t work. Please try again.');
}

export async function passkeyAnswer(optionsJSON: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON> {
  try {
    return await startAuthentication({ optionsJSON });
  } catch (error) {
    throw explain(error);
  }
}

export async function createPasskey(optionsJSON: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON> {
  try {
    return await startRegistration({ optionsJSON });
  } catch (error) {
    throw explain(error);
  }
}
