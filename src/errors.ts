/**
 * Typed errors. Every error the toolkit raises on purpose is a {@link ToolkitError} with a stable
 * `code` (part of the HTTP API) and the HTTP status the API answers with.
 */

/** Stable error codes. Never rename one: clients match on them. */
export type ToolkitErrorCode =
  | 'CONFIG_INVALID'
  | 'RPC_TIMEOUT'
  | 'RPC_UNAVAILABLE'
  | 'RPC_ERROR'
  | 'RPC_MALFORMED'
  | 'CONTRACT_ERROR'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Base class for every deliberate toolkit error. */
export class ToolkitError extends Error {
  /** Stable machine-readable code. */
  readonly code: ToolkitErrorCode;
  /** HTTP status the API uses for this error. */
  readonly status: number;

  /**
   * @param code - stable error code
   * @param status - HTTP status for API responses
   * @param message - human-readable description (safe to show to API clients)
   * @param cause - underlying error, kept for logs only
   */
  constructor(code: ToolkitErrorCode, status: number, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

/** The environment configuration is missing or invalid. */
export class ConfigError extends ToolkitError {
  /** @param message - which setting is wrong and why */
  constructor(message: string) {
    super('CONFIG_INVALID', 500, message);
  }
}

/** An RPC request did not answer within the configured timeout, after all retries. */
export class RpcTimeoutError extends ToolkitError {
  /**
   * @param method - JSON-RPC method name
   * @param timeoutMs - timeout per attempt
   */
  constructor(method: string, timeoutMs: number, cause?: unknown) {
    super('RPC_TIMEOUT', 504, `RPC ${method} timed out after ${String(timeoutMs)} ms`, cause);
  }
}

/** The RPC server could not be reached or answered with an HTTP error, after all retries. */
export class RpcUnavailableError extends ToolkitError {
  /** @param detail - what went wrong (HTTP status or network error) */
  constructor(method: string, detail: string, cause?: unknown) {
    super('RPC_UNAVAILABLE', 502, `RPC ${method} unavailable: ${detail}`, cause);
  }
}

/** The RPC server answered with a JSON-RPC error object. */
export class RpcResponseError extends ToolkitError {
  /** JSON-RPC error code. */
  readonly rpcCode: number;

  /**
   * @param rpcCode - JSON-RPC error code
   * @param rpcMessage - JSON-RPC error message
   */
  constructor(method: string, rpcCode: number, rpcMessage: string) {
    super('RPC_ERROR', 502, `RPC ${method} failed (${String(rpcCode)}): ${rpcMessage}`);
    this.rpcCode = rpcCode;
  }
}

/** The RPC server answered with something that does not match the expected shape. */
export class MalformedResponseError extends ToolkitError {
  /** @param detail - what did not match */
  constructor(what: string, detail: string, cause?: unknown) {
    super('RPC_MALFORMED', 502, `malformed ${what}: ${detail}`, cause);
  }
}

/** A contract call failed with one of the contract's own error codes. */
export class ContractCallError extends ToolkitError {
  /** Contract error code (see the contract's `Error` enum). */
  readonly contractCode: number;
  /** Contract error variant name, or `Unknown` for a code the bindings do not know. */
  readonly contractError: string;

  /**
   * @param fn - contract function that failed
   * @param contractCode - numeric contract error code
   * @param contractError - variant name
   */
  constructor(fn: string, contractCode: number, contractError: string) {
    super(
      'CONTRACT_ERROR',
      422,
      `contract call ${fn} failed with ${contractError} (#${String(contractCode)})`,
    );
    this.contractCode = contractCode;
    this.contractError = contractError;
  }
}

/** Client input failed validation. */
export class ValidationError extends ToolkitError {
  /** @param message - which field is invalid and why */
  constructor(message: string) {
    super('VALIDATION', 400, message);
  }
}

/** The requested resource does not exist. */
export class NotFoundError extends ToolkitError {
  /** @param what - the resource, for example `proposal 7` */
  constructor(what: string) {
    super('NOT_FOUND', 404, `${what} not found`);
  }
}

/** The request needs a valid session, or the sign-in proof was not accepted. */
export class UnauthorizedError extends ToolkitError {
  /** @param message - why the request is not authenticated */
  constructor(message: string) {
    super('UNAUTHORIZED', 401, message);
  }
}

/** The caller is authenticated but not allowed to do this. */
export class ForbiddenError extends ToolkitError {
  /** @param message - why the action is not allowed */
  constructor(message: string) {
    super('FORBIDDEN', 403, message);
  }
}

/** The request conflicts with the current state (for example, editing outside the allowed window). */
export class ConflictError extends ToolkitError {
  /** @param message - what conflicts */
  constructor(message: string) {
    super('CONFLICT', 409, message);
  }
}

/** Too many requests from one address in a short time. */
export class RateLimitError extends ToolkitError {
  /** Seconds until another request is allowed. */
  readonly retryAfterSecs: number;

  /** @param retryAfterSecs - seconds to wait */
  constructor(retryAfterSecs: number) {
    super('RATE_LIMITED', 429, `too many requests; retry in ${String(retryAfterSecs)} s`);
    this.retryAfterSecs = retryAfterSecs;
  }
}
