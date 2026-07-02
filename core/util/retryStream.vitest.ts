import { describe, expect, it, vi } from "vitest";

import {
  isRetryableLlmError,
  retryStreamWithEvents,
  retryOperation,
  retryStreamBeforeFirstOutput,
} from "./retryStream.js";

const NO_DELAY = {
  initialDelayMs: 0,
  maxDelayMs: 0,
  jitter: false,
};

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) {
    values.push(value);
  }
  return values;
}

describe("retryStreamBeforeFirstOutput", () => {
  it("retries a fetch failure before the first output", async () => {
    let attempt = 0;
    const onRetry = vi.fn();
    const createStream = () =>
      (async function* () {
        attempt += 1;
        if (attempt === 1) {
          throw new TypeError("fetch failed");
        }
        yield "recovered";
      })();

    await expect(
      collect(
        retryStreamBeforeFirstOutput(
          createStream,
          new AbortController().signal,
          { ...NO_DELAY, onRetry },
        ),
      ),
    ).resolves.toEqual(["recovered"]);
    expect(attempt).toBe(2);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, maxAttempts: 5 }),
    );
  });

  it("does not restart a stream after output was emitted", async () => {
    let attempt = 0;
    const createStream = () =>
      (async function* () {
        attempt += 1;
        yield "partial";
        throw new TypeError("fetch failed");
      })();

    const received: string[] = [];
    await expect(
      (async () => {
        for await (const value of retryStreamBeforeFirstOutput(
          createStream,
          new AbortController().signal,
          NO_DELAY,
        )) {
          received.push(value);
        }
      })(),
    ).rejects.toThrow("fetch failed");
    expect(received).toEqual(["partial"]);
    expect(attempt).toBe(1);
  });

  it("does not retry non-transient request errors", async () => {
    let attempt = 0;
    const createStream = () =>
      (async function* () {
        attempt += 1;
        throw Object.assign(new Error("invalid request"), { status: 400 });
      })();

    await expect(
      collect(
        retryStreamBeforeFirstOutput(
          createStream,
          new AbortController().signal,
          NO_DELAY,
        ),
      ),
    ).rejects.toThrow("invalid request");
    expect(attempt).toBe(1);
  });

  it("reports every retry and includes the last error after five attempts", async () => {
    let attempt = 0;
    const retries: number[] = [];
    const createStream = () =>
      (async function* () {
        attempt += 1;
        throw new TypeError("fetch failed");
      })();

    await expect(
      (async () => {
        for await (const event of retryStreamWithEvents(
          createStream,
          new AbortController().signal,
          NO_DELAY,
        )) {
          if (event.type === "retry") {
            retries.push(event.retry.attempt);
          }
        }
      })(),
    ).rejects.toThrow(
      "Automatic retry failed after 5 attempts. Last error: fetch failed",
    );
    expect(attempt).toBe(5);
    expect(retries).toEqual([2, 3, 4, 5]);
  });
});

describe("retryOperation", () => {
  it("retries retryable HTTP failures", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("unavailable"), {
          details: { status: 503 },
        }),
      )
      .mockResolvedValue("ok");

    await expect(
      retryOperation(operation, new AbortController().signal, NO_DELAY),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe("isRetryableLlmError", () => {
  it("recognizes nested network codes and rejects aborts", () => {
    expect(
      isRetryableLlmError(
        Object.assign(new Error("request failed"), {
          cause: { code: "ECONNRESET" },
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableLlmError(
        Object.assign(new Error("Request aborted"), { name: "AbortError" }),
      ),
    ).toBe(false);
  });
});
