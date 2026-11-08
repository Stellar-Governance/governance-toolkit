import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthService, Principal } from '../auth/service.js';
import type { CommentService } from '../discussion/comments.js';
import type { DraftService } from '../discussion/drafts.js';
import { ValidationError } from '../errors.js';
import type { Store } from '../store/types.js';

/** What the HTTP API needs. */
export interface ApiDeps {
  store: Store;
  auth: AuthService;
  drafts: DraftService;
  comments: CommentService;
  /** Browser origins allowed to call the API (exact match). */
  corsOrigins: readonly string[];
  /** Called for unexpected errors; never given request IPs. */
  logError?: (message: string, error: unknown) => void;
}

/** Error body of every failed request. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/**
 * Parses `value` with `schema` or throws a {@link ValidationError} naming the first bad field.
 * @param where - label for the message, for example `body`
 */
export function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const path = first === undefined ? '' : first.path.map(String).join('.');
  throw new ValidationError(
    `invalid ${where}${path ? ` field ${path}` : ''}: ${first?.message ?? 'invalid'}`,
  );
}

/** The bearer token from the `Authorization` header, if any. */
export function bearerToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h === undefined) return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m?.[1];
}

/**
 * Resolves the signed-in account of a request.
 * @throws {UnauthorizedError} without a valid session
 */
export async function requireSession(deps: ApiDeps, req: FastifyRequest): Promise<Principal> {
  return deps.auth.authenticate(bearerToken(req));
}

/**
 * The signed-in account if the request carries a session, `undefined` if it carries none.
 * @throws {UnauthorizedError} when a token is sent but is not a valid session
 */
export async function optionalSession(
  deps: ApiDeps,
  req: FastifyRequest,
): Promise<Principal | undefined> {
  const token = bearerToken(req);
  return token === undefined ? undefined : deps.auth.authenticate(token);
}
