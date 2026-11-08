import { RateLimitError } from '../errors.js';

/** Options for {@link RateLimiter}. */
export interface RateLimiterOptions {
  /** Most actions allowed per key within the window. */
  limit: number;
  windowSecs: number;
  /** Clock in seconds (tests pass a fake). */
  now?: () => number;
}

/**
 * Sliding-window limit per key (for example an address). In memory: one toolkit process is the
 * MVP deployment; several processes would each keep their own window.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;

  /** @param options - limit and window */
  constructor(private readonly options: RateLimiterOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Counts one action for `key`.
   * @throws {RateLimitError} when the key has used up its limit in the current window
   */
  hit(key: string): void {
    const now = this.now();
    const since = now - this.options.windowSecs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.options.limit) {
      const oldest = recent[0] ?? now;
      throw new RateLimitError(Math.max(1, oldest + this.options.windowSecs - now));
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(since);
  }

  private prune(since: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= since)) this.hits.delete(key);
    }
  }
}
