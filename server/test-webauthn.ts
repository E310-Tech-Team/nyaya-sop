/**
 * A software passkey authenticator for tests: a real P-256 key that makes genuine WebAuthn
 * registration and authentication responses (CBOR attestation "none", signed assertions), so the
 * server's checks run for real. Never used outside tests.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

const UP = 0x01; // user present
const UV = 0x04; // user verified
const AT = 0x40; // attested credential data included

export type SoftPasskey = { credentialId: string; privateKey: KeyObject; counter: number; userHandle: string };

type Overrides = { origin?: string; rpId?: string; userVerified?: boolean; challenge?: string };

const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash('sha256').update(data).digest());
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const uint32 = (value: number) => new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
const clientData = (type: string, challenge: string, origin: string) =>
  isoBase64URL.fromBuffer(new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })));

export class SoftAuthenticator {
  constructor(
    readonly origin = 'http://localhost',
    readonly rpId = 'localhost',
  ) {}

  /** Answers navigator.credentials.create with a new passkey. */
  register(options: PublicKeyCredentialCreationOptionsJSON, overrides: Overrides = {}): { response: RegistrationResponseJSON; passkey: SoftPasskey } {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)],
      ]),
    );
    const credentialIdBytes = new Uint8Array(randomBytes(32));
    const credentialId = isoBase64URL.fromBuffer(credentialIdBytes);
    const flags = UP | AT | (overrides.userVerified === false ? 0 : UV);
    const authData = concat(
      sha256(overrides.rpId ?? this.rpId),
      new Uint8Array([flags]),
      uint32(0),
      new Uint8Array(16), // AAGUID
      new Uint8Array([credentialIdBytes.length >> 8, credentialIdBytes.length & 255]),
      credentialIdBytes,
      cose,
    );
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
    const response: RegistrationResponseJSON = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: clientData('webauthn.create', overrides.challenge ?? options.challenge, overrides.origin ?? this.origin),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal'],
      },
    };
    return { response, passkey: { credentialId, privateKey, counter: 0, userHandle: options.user.id } };
  }

  /** Answers navigator.credentials.get with `passkey` (its counter goes up by one unless `counter` is given). */
  authenticate(
    passkey: SoftPasskey,
    options: PublicKeyCredentialRequestOptionsJSON,
    overrides: Overrides & { counter?: number; userHandle?: string | null } = {},
  ): AuthenticationResponseJSON {
    passkey.counter = overrides.counter ?? passkey.counter + 1;
    const flags = UP | (overrides.userVerified === false ? 0 : UV);
    const authData = concat(sha256(overrides.rpId ?? this.rpId), new Uint8Array([flags]), uint32(passkey.counter));
    const clientDataJSON = clientData('webauthn.get', overrides.challenge ?? options.challenge, overrides.origin ?? this.origin);
    const signature = sign('sha256', concat(authData, sha256(isoBase64URL.toBuffer(clientDataJSON))), passkey.privateKey);
    const userHandle = overrides.userHandle === undefined ? passkey.userHandle : overrides.userHandle;
    return {
      id: passkey.credentialId,
      rawId: passkey.credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON,
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
        ...(userHandle ? { userHandle } : {}),
      },
    };
  }
}
