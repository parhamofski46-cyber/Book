/** Base class for errors we raise deliberately and can map to an HTTP response. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 400, 'bad_request', context);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', context?: Record<string, unknown>) {
    super(message, 401, 'unauthorized', context);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', context?: Record<string, unknown>) {
    super(message, 403, 'forbidden', context);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', context?: Record<string, unknown>) {
    super(message, 404, 'not_found', context);
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = 'Monthly image quota exceeded', context?: Record<string, unknown>) {
    super(message, 402, 'quota_exceeded', context);
  }
}

/**
 * Signals that an operation failed but is worth retrying (rate limit, 5xx,
 * transient network fault). The queue uses this to decide between a retry with
 * backoff and a permanent failure.
 */
export class RetryableError extends AppError {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
    context?: Record<string, unknown>,
  ) {
    super(message, 503, 'retryable', context);
  }
}

export function isRetryable(err: unknown): err is RetryableError {
  return err instanceof RetryableError;
}

export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}
