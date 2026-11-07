import { z } from 'zod';
import {
  MalformedResponseError,
  RpcResponseError,
  RpcTimeoutError,
  RpcUnavailableError,
} from '../errors.js';

/** Sends one JSON-RPC request and returns its `result`. */
export interface RpcTransport {
  /**
   * @param method - JSON-RPC method, for example `getLatestLedger`
   * @param params - method parameters
   * @returns the raw `result` value (validate it before use)
   */
  request(method: string, params?: unknown): Promise<unknown>;
}

/** Options for {@link HttpRpcTransport}. */
export interface HttpRpcTransportOptions {
  /** RPC endpoint URL. */
  url: string;
  /** Timeout per attempt in milliseconds. */
  timeoutMs: number;
  /** Extra attempts after the first one, for timeouts, network errors, HTTP 429 and 5xx. */
  retries: number;
  /** Delay before the first retry; doubles on each further retry (capped at 30 s). */
  baseDelayMs?: number;
  /** `fetch` implementation (tests pass a fake). */
  fetch?: typeof fetch;
  /** Waits between retries (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
}

const envelope = z.union([
  z.object({ jsonrpc: z.literal('2.0'), result: z.unknown() }).refine((e) => 'result' in e),
  z.object({
    jsonrpc: z.literal('2.0'),
    error: z.object({ code: z.number(), message: z.string() }),
  }),
]);

class Retryable extends Error {
  constructor(
    readonly kind: 'timeout' | 'unavailable',
    message: string,
    readonly original?: unknown,
  ) {
    super(message);
  }
}

const MAX_DELAY_MS = 30_000;

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/**
 * JSON-RPC over HTTP POST with a timeout per attempt and exponential backoff.
 * JSON-RPC error objects are not retried: the server answered and the answer is final.
 */
export class HttpRpcTransport implements RpcTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseDelayMs: number;
  private nextId = 1;

  /** @param options - endpoint, timeout and retry settings */
  constructor(private readonly options: HttpRpcTransportOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.baseDelayMs = options.baseDelayMs ?? 500;
  }

  /** @inheritdoc */
  async request(method: string, params?: unknown): Promise<unknown> {
    let last: Retryable | undefined;
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      if (attempt > 0) {
        await this.sleep(Math.min(this.baseDelayMs * 2 ** (attempt - 1), MAX_DELAY_MS));
      }
      try {
        return await this.once(method, params);
      } catch (e) {
        if (!(e instanceof Retryable)) throw e;
        last = e;
      }
    }
    if (last?.kind === 'timeout') {
      throw new RpcTimeoutError(method, this.options.timeoutMs, last.original);
    }
    throw new RpcUnavailableError(method, last?.message ?? 'no attempt made', last?.original);
  }

  private async once(method: string, params: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (e) {
      if (isTimeout(e)) throw new Retryable('timeout', 'timed out', e);
      throw new Retryable('unavailable', e instanceof Error ? e.message : 'network error', e);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Retryable('unavailable', `HTTP ${String(response.status)}`);
    }
    if (!response.ok) {
      throw new RpcUnavailableError(method, `HTTP ${String(response.status)}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      if (isTimeout(e)) throw new Retryable('timeout', 'timed out reading the body', e);
      throw new MalformedResponseError(`${method} response`, 'body is not JSON', e);
    }
    const parsed = envelope.safeParse(body);
    if (!parsed.success) {
      throw new MalformedResponseError(`${method} response`, 'not a JSON-RPC 2.0 envelope');
    }
    if ('error' in parsed.data) {
      throw new RpcResponseError(method, parsed.data.error.code, parsed.data.error.message);
    }
    return parsed.data.result;
  }
}
