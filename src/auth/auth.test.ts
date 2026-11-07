import { Keypair, Networks } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../api/server.js';
import { SqliteStore } from '../store/sqlite.js';
import { AuthService, decodeSignature, hashToken } from './service.js';

interface Ctx {
  store: SqliteStore;
  clock: { now: number };
  app: ReturnType<typeof buildServer>;
  errors: unknown[];
}

const open: Ctx[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) {
    await c.app.close();
    await c.store.close();
  }
});

function setup(): Ctx {
  const store = new SqliteStore(':memory:');
  const clock = { now: 1_800_000_000 };
  const auth = new AuthService({
    store,
    domain: 'gov.example',
    networkPassphrase: Networks.TESTNET,
    challengeTtlSecs: 300,
    sessionTtlSecs: 3_600,
    now: () => clock.now,
  });
  const errors: unknown[] = [];
  const app = buildServer({
    store,
    auth,
    corsOrigins: ['http://localhost:3000'],
    logError: (_m, e) => errors.push(e),
  });
  const ctx = { store, clock, app, errors };
  open.push(ctx);
  return ctx;
}

async function challenge(ctx: Ctx, address: string) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/auth/challenge',
    payload: { address },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ nonce: string; message: string; expiresAt: number }>();
}

function sign(kp: Keypair, message: string, encoding: 'base64' | 'hex' = 'base64'): string {
  return Buffer.from(kp.signMessage(message)).toString(encoding);
}

async function verify(ctx: Ctx, payload: { address: string; nonce: string; signature: string }) {
  return ctx.app.inject({ method: 'POST', url: '/auth/verify', payload });
}

describe('sign-in with a SEP-53 signed challenge', () => {
  it('signs in with a valid signature and the session identifies the account', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    expect(c.message).toContain('gov.example wants you to sign in');
    expect(c.message).toContain(kp.publicKey());
    expect(c.message).toContain(`Nonce: ${c.nonce}`);
    expect(c.message).toContain(Networks.TESTNET);
    expect(c.expiresAt).toBe(ctx.clock.now + 300);

    const res = await verify(ctx, {
      address: kp.publicKey(),
      nonce: c.nonce,
      signature: sign(kp, c.message),
    });
    expect(res.statusCode).toBe(200);
    const session = res.json<{ token: string; address: string; expiresAt: number }>();
    expect(session.address).toBe(kp.publicKey());
    expect(session.token.length).toBeGreaterThanOrEqual(40);
    // Only the hash of the token is stored.
    expect(await ctx.store.getSession(session.token)).toBeUndefined();
    expect((await ctx.store.getSession(hashToken(session.token)))?.address).toBe(kp.publicKey());

    const who = await ctx.app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(who.statusCode).toBe(200);
    expect(who.json()).toEqual({ address: kp.publicKey(), expiresAt: session.expiresAt });
  });

  it('accepts a hex-encoded signature too', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    const res = await verify(ctx, {
      address: kp.publicKey(),
      nonce: c.nonce,
      signature: sign(kp, c.message, 'hex'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a signature made by another key', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    const res = await verify(ctx, {
      address: kp.publicKey(),
      nonce: c.nonce,
      signature: sign(Keypair.random(), c.message),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'signature does not match' },
    });
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects a signature over a different text', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    const res = await verify(ctx, {
      address: kp.publicKey(),
      nonce: c.nonce,
      signature: sign(kp, `${c.message} `),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a challenge used for another address', async () => {
    const ctx = setup();
    const alice = Keypair.random();
    const mallory = Keypair.random();
    const c = await challenge(ctx, alice.publicKey());
    const res = await verify(ctx, {
      address: mallory.publicKey(),
      nonce: c.nonce,
      signature: sign(mallory, c.message),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/different address/);
  });

  it('rejects an expired challenge', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    ctx.clock.now += 301;
    const res = await verify(ctx, {
      address: kp.publicKey(),
      nonce: c.nonce,
      signature: sign(kp, c.message),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { message: string } }>().error.message).toBe('challenge expired');
  });

  it('rejects a replayed nonce, even after a failed attempt', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    const payload = { address: kp.publicKey(), nonce: c.nonce, signature: sign(kp, c.message) };
    expect((await verify(ctx, payload)).statusCode).toBe(200);
    const replay = await verify(ctx, payload);
    expect(replay.statusCode).toBe(401);
    expect(replay.json<{ error: { message: string } }>().error.message).toBe(
      'challenge already used',
    );

    const c2 = await challenge(ctx, kp.publicKey());
    const bad = {
      address: kp.publicKey(),
      nonce: c2.nonce,
      signature: sign(Keypair.random(), c2.message),
    };
    expect((await verify(ctx, bad)).statusCode).toBe(401);
    const good = { ...bad, signature: sign(kp, c2.message) };
    expect((await verify(ctx, good)).statusCode).toBe(401);
  });

  it('rejects an unknown nonce', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const res = await verify(ctx, {
      address: kp.publicKey(),
      nonce: '0'.repeat(32),
      signature: sign(kp, 'x'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('expires sessions and supports sign-out', async () => {
    const ctx = setup();
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    const res = await verify(ctx, {
      address: kp.publicKey(),
      nonce: c.nonce,
      signature: sign(kp, c.message),
    });
    const { token } = res.json<{ token: string }>();
    const headers = { authorization: `Bearer ${token}` };
    ctx.clock.now += 3_600;
    const expired = await ctx.app.inject({ method: 'GET', url: '/auth/session', headers });
    expect(expired.statusCode).toBe(401);
    expect(expired.json<{ error: { message: string } }>().error.message).toBe('session expired');

    // A fresh session ends with logout.
    const c2 = await challenge(ctx, kp.publicKey());
    const res2 = await verify(ctx, {
      address: kp.publicKey(),
      nonce: c2.nonce,
      signature: sign(kp, c2.message),
    });
    const h2 = { authorization: `Bearer ${res2.json<{ token: string }>().token}` };
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/auth/logout', headers: h2 })).statusCode,
    ).toBe(204);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/auth/session', headers: h2 })).statusCode,
    ).toBe(401);
    expect(await ctx.store.purgeSessions(ctx.clock.now)).toBe(0);
  });

  it('requires a bearer token', async () => {
    const ctx = setup();
    const none = await ctx.app.inject({ method: 'GET', url: '/auth/session' });
    expect(none.statusCode).toBe(401);
    const junk = await ctx.app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { authorization: 'Bearer nope' },
    });
    expect(junk.statusCode).toBe(401);
  });

  it('validates input', async () => {
    const ctx = setup();
    const contract = 'CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F';
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/challenge',
      payload: { address: contract },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
    const extra = await ctx.app.inject({
      method: 'POST',
      url: '/auth/challenge',
      payload: { address: Keypair.random().publicKey(), admin: true },
    });
    expect(extra.statusCode).toBe(400);
    const kp = Keypair.random();
    const c = await challenge(ctx, kp.publicKey());
    const badSig = await verify(ctx, { address: kp.publicKey(), nonce: c.nonce, signature: 'zz' });
    expect(badSig.statusCode).toBe(400);
    const badJson = await ctx.app.inject({
      method: 'POST',
      url: '/auth/challenge',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
  });
});

describe('HTTP basics', () => {
  it('answers CORS only for allowed origins', async () => {
    const ctx = setup();
    const ok = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/auth/challenge',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    const denied = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/auth/challenge',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers unknown routes with a typed 404 and hides internal errors', async () => {
    const ctx = setup();
    const missing = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
    ctx.store.saveChallenge = () => Promise.reject(new Error('disk full at /secret/path'));
    const boom = await ctx.app.inject({
      method: 'POST',
      url: '/auth/challenge',
      payload: { address: Keypair.random().publicKey() },
    });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({ error: { code: 'INTERNAL', message: 'internal error' } });
    expect(ctx.errors).toHaveLength(1);
  });
});

describe('decodeSignature', () => {
  it('accepts 64 bytes as hex, base64 or base64url and rejects anything else', () => {
    const bytes = Buffer.alloc(64, 7);
    expect(decodeSignature(bytes.toString('hex'))).toHaveLength(64);
    expect(decodeSignature(bytes.toString('base64'))).toHaveLength(64);
    expect(decodeSignature(bytes.toString('base64url'))).toHaveLength(64);
    expect(decodeSignature(Buffer.alloc(63).toString('base64'))).toBeUndefined();
    expect(decodeSignature('not a signature!')).toBeUndefined();
  });
});
