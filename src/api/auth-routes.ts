import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bearerToken, parse, requireSession, type ApiDeps } from './http.js';

const challengeBody = z.object({ address: z.string().min(1).max(64) }).strict();
const verifyBody = z
  .object({
    address: z.string().min(1).max(64),
    nonce: z.string().regex(/^[0-9a-f]{32}$/, 'must be the nonce from /auth/challenge'),
    signature: z.string().min(1).max(200),
  })
  .strict();

/**
 * Sign-in routes:
 * - `POST /auth/challenge {address}` -> `{nonce, message, expiresAt}`
 * - `POST /auth/verify {address, nonce, signature}` -> `{token, address, expiresAt}`
 * - `GET /auth/session` (Bearer) -> `{address, expiresAt}`
 * - `POST /auth/logout` (Bearer) -> 204
 */
export function registerAuthRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post('/auth/challenge', async (req) => {
    const body = parse(challengeBody, req.body, 'body');
    return deps.auth.createChallenge(body.address);
  });

  app.post('/auth/verify', async (req) => {
    const body = parse(verifyBody, req.body, 'body');
    return deps.auth.verify(body);
  });

  app.get('/auth/session', async (req) => {
    return requireSession(deps, req);
  });

  app.post('/auth/logout', async (req, reply) => {
    await requireSession(deps, req);
    const token = bearerToken(req);
    if (token !== undefined) await deps.auth.logout(token);
    return reply.status(204).send();
  });
}
