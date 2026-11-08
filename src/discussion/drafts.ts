import { createHash, randomBytes } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import type { DraftStatus, Store, StoredDraft } from '../store/types.js';

/** Longest title in UTF-8 bytes; the same limit as the contract's proposal title. */
export const MAX_DRAFT_TITLE_BYTES = 120;
/** Longest Markdown body in UTF-8 bytes. */
export const MAX_DRAFT_BODY_BYTES = 32 * 1024;

/**
 * sha256 of the exact UTF-8 bytes of `body`, hex. This is the value to put in the proposal's
 * `description_hash`; anyone can recompute it from the text.
 */
export function contentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** The built-in proposal template. */
// WAVE-ISSUE(toolkit-1): more templates (parameter change, treasury transfer, signal) plug in here.
export const GENERIC_TEMPLATE = {
  id: 'generic',
  title: '',
  body: [
    '## Summary',
    '',
    'One or two sentences: what changes if this passes.',
    '',
    '## Motivation',
    '',
    'Why this is needed now.',
    '',
    '## Actions',
    '',
    'What the proposal does on-chain when executed (none for a signal proposal).',
    '',
    '## Risks',
    '',
    'What could go wrong, and how to undo it if it does.',
    '',
  ].join('\n'),
} as const;

function checkText(title: string | undefined, body: string | undefined): void {
  if (title !== undefined) {
    if (title.trim().length === 0) throw new ValidationError('title must not be empty');
    if (Buffer.byteLength(title, 'utf8') > MAX_DRAFT_TITLE_BYTES) {
      throw new ValidationError(`title must be at most ${String(MAX_DRAFT_TITLE_BYTES)} bytes`);
    }
  }
  if (body !== undefined) {
    if (body.trim().length === 0) throw new ValidationError('body must not be empty');
    if (Buffer.byteLength(body, 'utf8') > MAX_DRAFT_BODY_BYTES) {
      throw new ValidationError(`body must be at most ${String(MAX_DRAFT_BODY_BYTES)} bytes`);
    }
  }
}

/** Options for {@link DraftService}. */
export interface DraftServiceOptions {
  store: Store;
  /** Clock in seconds. */
  now?: () => number;
  /** Random bytes for ids. */
  random?: (size: number) => Buffer;
}

/**
 * Proposal drafts. A draft starts private (`draft`) and becomes public when published; publishing
 * is one-way. Once its text matches an on-chain proposal it is linked and can no longer change,
 * because the text is then what people voted on.
 */
// WAVE-ISSUE(toolkit-3): export and import of drafts (Markdown + JSON) plug in here.
export class DraftService {
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;

  /** @param options - store, clock and randomness */
  constructor(private readonly options: DraftServiceOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.random = options.random ?? randomBytes;
  }

  /** The built-in template. */
  template(): typeof GENERIC_TEMPLATE {
    return GENERIC_TEMPLATE;
  }

  private async withLink(d: StoredDraft): Promise<StoredDraft> {
    if (d.status !== 'published' || d.proposalId !== null) return d;
    const proposalId = await this.options.store.proposalIdByHash(d.contentHash);
    return proposalId === undefined ? d : { ...d, proposalId };
  }

  /**
   * Creates a draft for `author`.
   * @throws {ValidationError} for an empty or too long title or body
   */
  async create(
    author: string,
    input: { title: string; body: string; status?: DraftStatus | undefined },
  ): Promise<StoredDraft> {
    checkText(input.title, input.body);
    const now = this.now();
    const draft = await this.withLink({
      id: this.random(12).toString('base64url'),
      author,
      title: input.title,
      body: input.body,
      contentHash: contentHash(input.body),
      status: input.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
      proposalId: null,
    });
    await this.options.store.createDraft(draft);
    return draft;
  }

  /**
   * Changes a draft. Only its author may; a linked draft cannot change; published cannot go
   * back to draft.
   * @throws {NotFoundError} if the draft does not exist (or is private to someone else)
   * @throws {ForbiddenError} if `author` did not write it
   * @throws {ConflictError} if it is linked to an on-chain proposal, or on unpublishing
   */
  async update(
    author: string,
    id: string,
    patch: {
      title?: string | undefined;
      body?: string | undefined;
      status?: DraftStatus | undefined;
    },
  ): Promise<StoredDraft> {
    const current = await this.get(id, author);
    if (current.author !== author) throw new ForbiddenError('only the author can edit a draft');
    if (current.proposalId !== null) {
      throw new ConflictError(
        `the draft is linked to on-chain proposal ${String(current.proposalId)} and cannot change`,
      );
    }
    if (current.status === 'published' && patch.status === 'draft') {
      throw new ConflictError('a published draft cannot be made private again');
    }
    checkText(patch.title, patch.body);
    const body = patch.body ?? current.body;
    const next = await this.withLink({
      ...current,
      title: patch.title ?? current.title,
      body,
      contentHash: contentHash(body),
      status: patch.status ?? current.status,
      updatedAt: this.now(),
    });
    await this.options.store.updateDraft(next);
    return next;
  }

  /**
   * A draft by id, as `viewer` may see it.
   * @throws {NotFoundError} if it does not exist, or is private and `viewer` is not its author
   */
  async get(id: string, viewer?: string): Promise<StoredDraft> {
    const d = await this.options.store.getDraft(id);
    if (d === undefined || (d.status === 'draft' && d.author !== viewer)) {
      throw new NotFoundError(`draft ${id}`);
    }
    return d;
  }

  /**
   * Published drafts (optionally by one author), or all of `mine`'s drafts.
   */
  async list(q: {
    author?: string | undefined;
    mine?: string | undefined;
    before?: string | undefined;
    limit: number;
  }): Promise<{ drafts: StoredDraft[]; next: string | undefined }> {
    if (q.mine !== undefined) {
      return this.options.store.listDrafts({ author: q.mine, before: q.before, limit: q.limit });
    }
    return this.options.store.listDrafts({
      author: q.author,
      status: 'published',
      before: q.before,
      limit: q.limit,
    });
  }

  /** Published drafts whose text is the text of proposal `proposalId`. */
  async forProposal(proposalId: number): Promise<StoredDraft[]> {
    return this.options.store.draftsForProposal(proposalId);
  }
}
