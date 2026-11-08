import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import type { RateLimiter } from '../api/rate-limit.js';
import type { CommentTarget, Store, StoredComment } from '../store/types.js';

/** Longest comment in UTF-8 bytes. */
export const MAX_COMMENT_BYTES = 4_000;
/** How long after posting an author may edit or delete a comment. */
export const COMMENT_EDIT_WINDOW_SECS = 15 * 60;

/** Options for {@link CommentService}. */
export interface CommentServiceOptions {
  store: Store;
  /** Limits how fast one address can post. */
  limiter: RateLimiter;
  editWindowSecs?: number;
  /** Clock in seconds. */
  now?: () => number;
}

function checkBody(body: string): void {
  if (body.trim().length === 0) throw new ValidationError('comment must not be empty');
  if (Buffer.byteLength(body, 'utf8') > MAX_COMMENT_BYTES) {
    throw new ValidationError(`comment must be at most ${String(MAX_COMMENT_BYTES)} bytes`);
  }
}

/**
 * Flat comment lists on published drafts and on indexed proposals.
 */
// WAVE-ISSUE(toolkit-2): threaded replies (a parent comment id) plug in here.
// WAVE-ISSUE(toolkit-4): signed voting-intention signals (one per address per draft) would sit
// next to comments, keyed the same way.
export class CommentService {
  private readonly now: () => number;
  private readonly editWindowSecs: number;

  /** @param options - store, rate limiter and edit window */
  constructor(private readonly options: CommentServiceOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.editWindowSecs = options.editWindowSecs ?? COMMENT_EDIT_WINDOW_SECS;
  }

  /**
   * @throws {NotFoundError} unless the target is a published draft or an indexed proposal
   */
  private async checkTarget(target: CommentTarget): Promise<void> {
    const { store } = this.options;
    if (target.type === 'draft') {
      const d = await store.getDraft(target.id);
      if (d === undefined || d.status !== 'published')
        throw new NotFoundError(`draft ${target.id}`);
    } else if ((await store.getProposal(target.id)) === undefined) {
      throw new NotFoundError(`proposal ${String(target.id)}`);
    }
  }

  /** Comments on a target, oldest first. */
  async list(
    target: CommentTarget,
    q: { afterId?: number | undefined; limit: number },
  ): Promise<StoredComment[]> {
    await this.checkTarget(target);
    return this.options.store.listComments(target, q);
  }

  /**
   * Posts a comment as `author`.
   * @throws {RateLimitError} when `author` posts too fast
   */
  async add(author: string, target: CommentTarget, body: string): Promise<StoredComment> {
    checkBody(body);
    await this.checkTarget(target);
    this.options.limiter.hit(author);
    const comment = { target, author, body, createdAt: this.now(), editedAt: null };
    const id = await this.options.store.addComment(comment);
    return { id, ...comment };
  }

  private async own(author: string, id: number): Promise<StoredComment> {
    const c = await this.options.store.getComment(id);
    if (c === undefined) throw new NotFoundError(`comment ${String(id)}`);
    if (c.author !== author) throw new ForbiddenError('only the author can change a comment');
    if (this.now() > c.createdAt + this.editWindowSecs) {
      throw new ConflictError(
        `comments can only be changed within ${String(this.editWindowSecs / 60)} minutes of posting`,
      );
    }
    return c;
  }

  /** Changes the body of `author`'s own comment, within the edit window. */
  async edit(author: string, id: number, body: string): Promise<StoredComment> {
    checkBody(body);
    const c = await this.own(author, id);
    const editedAt = this.now();
    await this.options.store.editComment(id, body, editedAt);
    return { ...c, body, editedAt };
  }

  /** Deletes `author`'s own comment, within the edit window. */
  async remove(author: string, id: number): Promise<void> {
    await this.own(author, id);
    await this.options.store.deleteComment(id);
  }
}
