export interface RetryOptions {
  /** Total attempts, including the initial request. */
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  onRetry?: (event: RetryEvent) => void;
}

export interface RetryEvent {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

export type RetryStreamEvent<T> =
  | { type: "output"; value: T }
  | { type: "retry"; retry: RetryEvent };

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    const detail =
      lastError instanceof Error ? lastError.message : String(lastError);
    super(
      `Automatic retry failed after ${attempts} attempts. Last error: ${detail}`,
      { cause: lastError },
    );
    this.name = "RetryExhaustedError";
  }
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
  maxAttempts: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 8_000,
  jitter: true,
};

const RETRYABLE_STATUS_CODES = new Set([
  408, 425, 429, 500, 502, 503, 504, 522, 524,
]);

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  "fetch failed",
  "failed to fetch",
  "network request failed",
  "internet disconnected",
  "network connection was lost",
  "connection reset",
  "connection refused",
  "connection closed",
  "socket hang up",
  "premature close",
  "premature end",
  "temporarily unavailable",
  "service unavailable",
  "gateway timeout",
  "bad gateway",
  "overloaded",
  "rate limit",
];

function getStatus(error: any): number | undefined {
  return error?.response?.status ?? error?.details?.status ?? error?.status;
}

function getErrorCode(error: any): string | undefined {
  return error?.code ?? error?.cause?.code;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage =
      error.cause instanceof Error ? ` ${error.cause.message}` : "";
    return `${error.message}${causeMessage}`.toLowerCase();
  }
  return String(error ?? "").toLowerCase();
}

export function isAbortLikeError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : undefined;
  const message = getErrorMessage(error);
  return (
    name === "AbortError" ||
    message === "request aborted" ||
    message.includes("operation was aborted")
  );
}

export function isRetryableLlmError(error: unknown): boolean {
  if (isAbortLikeError(error)) {
    return false;
  }

  const status = getStatus(error);
  if (typeof status === "number") {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  const code = getErrorCode(error);
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const type = (error as any)?.type;
  if (type === "server_error" || type === "rate_limit_exceeded") {
    return true;
  }

  const message = getErrorMessage(error);
  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) =>
    message.includes(pattern),
  );
}

function retryDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, "onRetry">>,
): number {
  const baseDelay = Math.min(
    options.initialDelayMs * 2 ** (attempt - 1),
    options.maxDelayMs,
  );
  if (!options.jitter) {
    return baseDelay;
  }
  return Math.round(baseDelay * (0.75 + Math.random() * 0.5));
}

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

async function waitForRetry(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) {
    throw abortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Retries a transiently failed stream only when it has not emitted a value.
 * Once output is visible to a caller, restarting could duplicate text or tool
 * calls, so the original error is surfaced instead.
 */
export async function* retryStreamWithEvents<T>(
  createStream: () => AsyncIterable<T>,
  signal: AbortSignal,
  retryOptions: RetryOptions = {},
): AsyncGenerator<RetryStreamEvent<T>> {
  const options = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    let emittedOutput = false;
    try {
      if (signal.aborted) {
        throw abortError();
      }

      for await (const value of createStream()) {
        emittedOutput = true;
        yield { type: "output", value };
      }
      return;
    } catch (error) {
      if (signal.aborted || emittedOutput || !isRetryableLlmError(error)) {
        throw error;
      }

      if (attempt === options.maxAttempts) {
        throw new RetryExhaustedError(options.maxAttempts, error);
      }

      const delayMs = retryDelay(attempt, options);
      const retry = {
        attempt: attempt + 1,
        maxAttempts: options.maxAttempts,
        delayMs,
        error,
      };
      retryOptions.onRetry?.(retry);
      yield { type: "retry", retry };
      await waitForRetry(delayMs, signal);
    }
  }
}

export async function* retryStreamBeforeFirstOutput<T>(
  createStream: () => AsyncIterable<T>,
  signal: AbortSignal,
  retryOptions: RetryOptions = {},
): AsyncGenerator<T> {
  for await (const event of retryStreamWithEvents(
    createStream,
    signal,
    retryOptions,
  )) {
    if (event.type === "output") {
      yield event.value;
    }
  }
}

export async function retryOperation<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  retryOptions: RetryOptions = {},
): Promise<T> {
  const options = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      if (signal.aborted) {
        throw abortError();
      }
      return await operation();
    } catch (error) {
      if (signal.aborted || !isRetryableLlmError(error)) {
        throw error;
      }

      if (attempt === options.maxAttempts) {
        throw new RetryExhaustedError(options.maxAttempts, error);
      }

      const delayMs = retryDelay(attempt, options);
      retryOptions.onRetry?.({
        attempt: attempt + 1,
        maxAttempts: options.maxAttempts,
        delayMs,
        error,
      });
      await waitForRetry(delayMs, signal);
    }
  }

  throw new Error("Retry operation exhausted without a result");
}
