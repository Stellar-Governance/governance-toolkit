import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StoredComment, StoredDraft } from '../store/types.js';
import { optionalSession, parse, requireSession, type ApiDeps } from './http.js';

/** Page size: 1..200, default 50. */
export const limitParam = z.coerce.number().int().min(1).max(200).default(50);

const draftId = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'not a draft id') });
const numericId = z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const status = z.enum(['draft', 'published']);

const createDraftBody = z
  .object({ title: z.string(), body: z.string(), status: status.optional() })
  .strict();
const patchDraftBody = z
  .object({ title: z.string().optional(), body: z.string().optional(), status: status.optional() })
  .strict()
  .refine((p) => p.title !== undefined || p.body !== undefined || p.status !== undefined, {
    message: 'nothing to change',
  });
const listDraftsQuery = z
  .object({
    author: z.string().max(64).optional(),
    mine: z.enum(['true', 'false']).optional(),
    cursor: z
      .string()
      .regex(/^\d{1,16}$/, 'not a cursor')
      .optional(),
    limit: limitParam,
  })
  .strict();
const commentBody = z.object({ body: z.string() }).strict();
const listCommentsQuery = z
  .object({ cursor: z.coerce.number().int().nonnegative().optional(), limit: limitParam })
  .strict();

/** JSON shape of a draft. */
export function draftJson(d: StoredDraft) {
  return {
    id: d.id,
    author: d.author,
    title: d.title,
    body: d.body,
    contentHash: d.contentHash,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    proposalId: d.proposalId,
  };
}

/** JSON shape of a comment. */
export function commentJson(c: StoredComment) {
  return {
    id: c.id,
    target: c.target,
    author: c.author,
    body: c.body,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
  };
}

function commentPage(comments: StoredComment[], limit: number) {
  const last = comments.at(-1);
  return {
    items: comments.map(commentJson),
    next: comments.length === limit && last !== undefined ? String(last.id) : null,
  };
}

/**
 * Drafts and comments:
 * - `GET /drafts/template`
 * - `GET /drafts?author=&mine=true&cursor=&limit=` (published drafts; `mine` needs a session)
 * - `POST /drafts`, `GET /drafts/:id`, `PATCH /drafts/:id`
 * - `GET|POST /drafts/:id/comments`, `GET|POST /proposals/:id/comments`
 * - `PATCH /comments/:id`, `DELETE /comments/:id`
 */
export function registerDiscussionRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/drafts/template', (_req, reply) => reply.send(deps.drafts.template()));

  app.get('/drafts', async (req) => {
    const q = parse(listDraftsQuery, req.query, 'query');
    const viewer = q.mine === 'true' ? (await requireSession(deps, req)).address : undefined;
    const page = await deps.drafts.list({
      author: q.author,
      mine: viewer,
      before: q.cursor,
      limit: q.limit,
    });
    return { items: page.drafts.map(draftJson), next: page.next ?? null };
  });

  app.post('/drafts', async (req, reply) => {
    const session = await requireSession(deps, req);
    const body = parse(createDraftBody, req.body, 'body');
    const draft = await deps.drafts.create(session.address, body);
    return reply.status(201).send(draftJson(draft));
  });

  app.get('/drafts/:id', async (req) => {
    const { id } = parse(draftId, req.params, 'path');
    const viewer = await optionalSession(deps, req);
    return draftJson(await deps.drafts.get(id, viewer?.address));
  });

  app.patch('/drafts/:id', async (req) => {
    const session = await requireSession(deps, req);
    const { id } = parse(draftId, req.params, 'path');
    const patch = parse(patchDraftBody, req.body, 'body');
    return draftJson(await deps.drafts.update(session.address, id, patch));
  });

  app.get('/drafts/:id/comments', async (req) => {
    const { id } = parse(draftId, req.params, 'path');
    const q = parse(listCommentsQuery, req.query, 'query');
    const comments = await deps.comments.list(
      { type: 'draft', id },
      { afterId: q.cursor, limit: q.limit },
    );
    return commentPage(comments, q.limit);
  });

  app.post('/drafts/:id/comments', async (req, reply) => {
    const session = await requireSession(deps, req);
    const { id } = parse(draftId, req.params, 'path');
    const { body } = parse(commentBody, req.body, 'body');
    const c = await deps.comments.add(session.address, { type: 'draft', id }, body);
    return reply.status(201).send(commentJson(c));
  });

  app.get('/proposals/:id/comments', async (req) => {
    const { id } = parse(numericId, req.params, 'path');
    const q = parse(listCommentsQuery, req.query, 'query');
    const comments = await deps.comments.list(
      { type: 'proposal', id },
      { afterId: q.cursor, limit: q.limit },
    );
    return commentPage(comments, q.limit);
  });

  app.post('/proposals/:id/comments', async (req, reply) => {
    const session = await requireSession(deps, req);
    const { id } = parse(numericId, req.params, 'path');
    const { body } = parse(commentBody, req.body, 'body');
    const c = await deps.comments.add(session.address, { type: 'proposal', id }, body);
    return reply.status(201).send(commentJson(c));
  });

  app.patch('/comments/:id', async (req) => {
    const session = await requireSession(deps, req);
    const { id } = parse(numericId, req.params, 'path');
    const { body } = parse(commentBody, req.body, 'body');
    return commentJson(await deps.comments.edit(session.address, id, body));
  });

  app.delete('/comments/:id', async (req, reply) => {
    const session = await requireSession(deps, req);
    const { id } = parse(numericId, req.params, 'path');
    await deps.comments.remove(session.address, id);
    return reply.status(204).send();
  });
}
