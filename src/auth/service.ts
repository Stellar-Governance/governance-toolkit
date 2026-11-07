import { createHash, randomBytes } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { UnauthorizedError, ValidationError } from '../errors.js';
import type { Store } from '../store/types.js';

/** Options for {@link AuthService}. */
export interface AuthServiceOptions {
  store: Store;
  /** Shown in the challenge text, so a signer sees which site asks (for example the frontend host). */
  domain: string;
  /** Written into the challenge so a signature is bound to one network. */
  networkPassphrase: string;
  challengeTtlSecs: number;
  sessionTtlSecs: number;
  /** Server clock in seconds. */
  now?: () => number;
  /** Random bytes (tests pass a fixed source). */
  random?: (size: number) => Buffer;
}

/** A challenge for the wallet to sign. */
export interface ChallengeResult {
  nonce: string;
  /** Sign exactly this text with SEP-53 (`signMessage`). */
  message: string;
  expiresAt: number;
}

/** A signed-in session. `token` is only ever returned once. */
export interface SessionResult {
  token: string;
  address: string;
  expiresAt: number;
}

/** The account behind a valid session. */
export interface Principal {
  address: string;
  expiresAt: number;
}

/** sha256 of a session token, hex. Only this is stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Decodes a wallet signature given as hex or base64 (SEP-53 does not fix the encoding).
 * @returns the 64 signature bytes, or `undefined` if it is neither
 */
export function decodeSignature(signature: string): Uint8Array | undefined {
  const s = signature.trim();
  if (/^[0-9a-fA-F]{128}$/.test(s)) return Uint8Array.from(Buffer.from(s, 'hex'));
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) {
    const bytes = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (bytes.length === 64) return Uint8Array.from(bytes);
  }
  return undefined;
}

/**
 * Sign-in with a SEP-53 signed message (decision D15).
 *
 * 1. `createChallenge(address)` stores a single-use nonce and returns a text that names the
 *    domain, the network, the nonce and the expiry.
 * 2. The wallet signs that text with SEP-53 (`SHA-256("Stellar Signed Message:\n" + text)`).
 * 3. `verify` checks the nonce (unknown, used, expired), the address, and the signature, then
 *    issues a random session token. Only its sha256 is stored.
 */
export class AuthService {
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;

  /** @param options - store, domain, network and lifetimes */
  constructor(private readonly options: AuthServiceOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.random = options.random ?? randomBytes;
  }

  /**
   * Issues a challenge for `address`.
   * @throws {ValidationError} if `address` is not a Stellar account (G...); contract accounts
   *   cannot sign messages
   */
  async createChallenge(address: string): Promise<ChallengeResult> {
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new ValidationError('address must be a Stellar account id (G...)');
    }
    const now = this.now();
    const nonce = this.random(16).toString('hex');
    const expiresAt = now + this.options.challengeTtlSecs;
    const message = [
      `${this.options.domain} wants you to sign in with your Stellar account:`,
      address,
      '',
      'This signs in to Stellar Governance discussion. It is not a transaction and costs nothing.',
      '',
      `Network: ${this.options.networkPassphrase}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now * 1000).toISOString()}`,
      `Expiration Time: ${new Date(expiresAt * 1000).toISOString()}`,
    ].join('\n');
    await this.options.store.saveChallenge({ nonce, address, message, expiresAt }, now);
    return { nonce, message, expiresAt };
  }

  /**
   * Checks a signed challenge and starts a session. The nonce is used up by this call whether
   * or not the signature is valid.
   * @throws {UnauthorizedError} for an unknown, used or expired nonce, a different address, or a
   *   signature that does not verify
   * @throws {ValidationError} for a signature that is not 64 bytes of hex or base64
   */
  async verify(input: {
    address: string;
    nonce: string;
    signature: string;
  }): Promise<SessionResult> {
    const signature = decodeSignature(input.signature);
    if (signature === undefined) {
      throw new ValidationError('signature must be 64 bytes, hex or base64');
    }
    const challenge = await this.options.store.consumeChallenge(input.nonce);
    const now = this.now();
    if (challenge === undefined) throw new UnauthorizedError('unknown challenge');
    if (challenge.alreadyUsed) throw new UnauthorizedError('challenge already used');
    if (challenge.expiresAt <= now) throw new UnauthorizedError('challenge expired');
    if (challenge.address !== input.address) {
      throw new UnauthorizedError('challenge was issued to a different address');
    }
    let valid: boolean;
    try {
      valid = Keypair.fromPublicKey(challenge.address).verifyMessage(challenge.message, signature);
    } catch {
      valid = false;
    }
    if (!valid) throw new UnauthorizedError('signature does not match');
    const token = this.random(32).toString('base64url');
    const expiresAt = now + this.options.sessionTtlSecs;
    await this.options.store.createSession({
      idHash: hashToken(token),
      address: challenge.address,
      createdAt: now,
      expiresAt,
    });
    return { token, address: challenge.address, expiresAt };
  }

  /**
   * Resolves a session token.
   * @throws {UnauthorizedError} for a missing, unknown or expired session
   */
  async authenticate(token: string | undefined): Promise<Principal> {
    if (token === undefined || token.length === 0) throw new UnauthorizedError('sign-in required');
    const session = await this.options.store.getSession(hashToken(token));
    if (session === undefined) throw new UnauthorizedError('unknown session');
    if (session.expiresAt <= this.now()) {
      await this.options.store.deleteSession(session.idHash);
      throw new UnauthorizedError('session expired');
    }
    return { address: session.address, expiresAt: session.expiresAt };
  }

  /** Ends a session. Unknown tokens are ignored. */
  async logout(token: string): Promise<void> {
    await this.options.store.deleteSession(hashToken(token));
  }
}
