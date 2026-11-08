import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { NotFoundError, RateLimitError, ToolkitError, UnauthorizedError } from '../errors.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerDiscussionRoutes } from './discussion-routes.js';
import { registerReadRoutes } from './read-routes.js';
import type { ApiDeps, ErrorBody } from './http.js';

export type { ApiDeps, ErrorBody, IndexerHealth, ServiceInfo } from './http.js';

function sendError(reply: FastifyReply, status: number, code: string, message: string): void {
  const body: ErrorBody = { error: { code, message } };
  void reply.status(status).send(body);
}

/** Options for {@link buildServer}. */
export interface BuildOptions {
  /** Called for every registered route (used by the OpenAPI drift test). */
  onRoute?: (route: { method: string; url: string }) => void;
}

/**
 * Builds the HTTP API (not listening yet). Sessions travel in `Authorization: Bearer`; no
 * cookies are set, and CORS answers only the configured origins.
 */
export function buildServer(deps: ApiDeps, options: BuildOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const allowed = new Set(deps.corsOrigins);
  const { onRoute } = options;
  if (onRoute !== undefined) {
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) if (method !== 'HEAD') onRoute({ method, url: route.url });
    });
  }

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin !== undefined && allowed.has(origin)) {
      void reply.header('access-control-allow-origin', origin);
      void reply.header('vary', 'Origin');
      void reply.header('access-control-allow-headers', 'content-type, authorization');
      void reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      void reply.header('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') {
      await reply.status(origin !== undefined && allowed.has(origin) ? 204 : 403).send();
    }
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ToolkitError) {
      if (err instanceof UnauthorizedError) void reply.header('www-authenticate', 'Bearer');
      if (err instanceof RateLimitError)
        void reply.header('retry-after', String(err.retryAfterSecs));
      sendError(reply, err.status, err.code, err.message);
      return;
    }
    const status =
      typeof err === 'object' && err !== null && 'statusCode' in err ? Number(err.statusCode) : 500;
    if (status >= 400 && status < 500) {
      // Fastify's own client errors: bad JSON, body too large, wrong content type.
      sendError(reply, status, 'VALIDATION', 'the request could not be read');
      return;
    }
    deps.logError?.('unexpected error', err);
    sendError(reply, 500, 'INTERNAL', 'internal error');
  });

  app.setNotFoundHandler((_req, reply) => {
    const e = new NotFoundError('route');
    sendError(reply, e.status, e.code, e.message);
  });

  registerAuthRoutes(app, deps);
  registerDiscussionRoutes(app, deps);
  registerReadRoutes(app, deps);
  return app;
}
