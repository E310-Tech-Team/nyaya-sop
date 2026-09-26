/**
 * Cryptographic helpers, all from node:crypto.
 *
 * - Link and session tokens are 256-bit random values; only their SHA-256 hash is stored.
 * - Keys for CSRF tokens and at-rest encryption are derived from APP_SECRET with HKDF, one
 *   per purpose, so no key is used for two things.
 * - Staff passwords use scrypt (N=2^15, r=8, p=3: one of OWASP's equivalent-strength settings).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from 'node:crypto';

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256Hex = (value: BinaryLike): string => createHash('sha256').update(value).digest('hex');

/** Constant-time string comparison (hashes both sides first, so lengths don't leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export class Secrets {
  readonly #hmacKey: Buffer;
  readonly #dataKey: Buffer;

  constructor(appSecret: string) {
    const ikm = Buffer.from(appSecret, 'utf8');
    const derive = (info: string) => Buffer.from(hkdfSync('sha256', ikm, Buffer.from('school-of-purpose'), info, 32));
    this.#hmacKey = derive('hmac/v1');
    this.#dataKey = derive('data-encryption/v1');
  }

  /** base64url HMAC-SHA256 of `value`, bound to `purpose`. */
  hmac(purpose: string, value: string): string {
    return createHmac('sha256', this.#hmacKey).update(`${purpose}\u0000${value}`).digest('base64url');
  }

  /** AES-256-GCM. Output: "v1.<iv>.<ciphertext+tag>" (base64url). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#dataKey, iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `v1.${iv.toString('base64url')}.${body.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [version, ivText, bodyText] = payload.split('.');
    if (version !== 'v1' || !ivText || !bodyText) throw new Error('Unrecognised encrypted value');
    const body = Buffer.from(bodyText, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.#dataKey, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  }
}

// ── Passwords ────────────────────────────────────────────────────────────────

const SCRYPT = { N: 2 ** 15, r: 8, p: 3, keyLength: 32, maxmem: 64 * 1024 * 1024 } as const;

const scrypt = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password.normalize('NFKC'), salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key))),
  );

export const PASSWORD_LIMITS = { min: 12, max: 128 } as const;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_LIMITS.min) {
    return `Use at least ${PASSWORD_LIMITS.min} characters. A few unrelated words works well.`;
  }
  if (password.length > PASSWORD_LIMITS.max) return `Use ${PASSWORD_LIMITS.max} characters or fewer.`;
  if (/^(.)\1+$/.test(password)) return 'Choose a password that isn’t one repeated character.';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${Math.log2(SCRYPT.N)}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, logN, r, p, saltText, keyText] = stored.split('$');
  if (scheme !== 'scrypt' || !logN || !r || !p || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const key = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, {
    N: 2 ** Number(logN),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Same cost as a real check, for unknown accounts (so timing doesn't reveal which emails exist). */
const DUMMY_HASH_PROMISE = hashPassword(randomToken());
export async function verifyDummyPassword(password: string): Promise<false> {
  await verifyPassword(password, await DUMMY_HASH_PROMISE);
  return false;
}

// ── Recovery codes ───────────────────────────────────────────────────────────

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L, U

/** "ABCDE-FGHJK": 10 characters from a 30-symbol alphabet (~49 bits), shown once. */
export function newRecoveryCode(): string {
  // Rejection sampling: bytes ≥ 240 (8 × 30) are discarded so every symbol is equally likely.
  let chars = '';
  while (chars.length < 10) {
    for (const byte of randomBytes(16)) {
      if (byte < 240 && chars.length < 10) chars += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }
  }
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export const normaliseRecoveryCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
