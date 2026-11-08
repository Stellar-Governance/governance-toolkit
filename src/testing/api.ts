/**
 * Builds the whole HTTP API on an in-memory store with one fake clock, for tests.
 */
import { Keypair, Networks } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';
import { RateLimiter } from '../api/rate-limit.js';
import { buildServer } from '../api/server.js';
import { AuthService } from '../auth/service.js';
import { CommentService } from '../discussion/comments.js';
import { DraftService } from '../discussion/drafts.js';
import { SqliteStore } from '../store/sqlite.js';

/** A test API and its parts. */
export interface TestApi {
  store: SqliteStore;
  clock: { now: number };
  app: FastifyInstance;
  auth: AuthService;
  drafts: DraftService;
  comments: CommentService;
  /** Unexpected errors reported by the error handler. */
  errors: unknown[];
  /** Signs in a (new or given) key and returns its auth header. */
  signIn(
    kp?: Keypair,
  ): Promise<{ address: string; token: string; headers: { authorization: string } }>;
  close(): Promise<void>;
}

/** Options for {@link testApi}. */
export interface TestApiOptions {
  corsOrigins?: string[];
  /** Comments per address per minute. */
  commentLimit?: number;
}

/** Creates a test API. Call `close()` when done. */
export function testApi(options: TestApiOptions = {}): TestApi {
  const store = new SqliteStore(':memory:');
  const clock = { now: 1_800_000_000 };
  const now = () => clock.now;
  const auth = new AuthService({
    store,
    domain: 'gov.example',
    networkPassphrase: Networks.TESTNET,
    challengeTtlSecs: 300,
    sessionTtlSecs: 3_600,
    now,
  });
  const drafts = new DraftService({ store, now });
  const comments = new CommentService({
    store,
    now,
    limiter: new RateLimiter({ limit: options.commentLimit ?? 5, windowSecs: 60, now }),
  });
  const errors: unknown[] = [];
  const app = buildServer({
    store,
    auth,
    drafts,
    comments,
    corsOrigins: options.corsOrigins ?? ['http://localhost:3000'],
    logError: (_m, e) => errors.push(e),
  });
  return {
    store,
    clock,
    app,
    auth,
    drafts,
    comments,
    errors,
    async signIn(kp = Keypair.random()) {
      const c = await auth.createChallenge(kp.publicKey());
      const s = await auth.verify({
        address: kp.publicKey(),
        nonce: c.nonce,
        signature: Buffer.from(kp.signMessage(c.message)).toString('base64'),
      });
      return {
        address: s.address,
        token: s.token,
        headers: { authorization: `Bearer ${s.token}` },
      };
    },
    async close() {
      await app.close();
      await store.close();
    },
  };
}
