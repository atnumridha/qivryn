import type { ChatMessage } from "core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStreamUpdateBatcher,
  STREAM_UPDATE_INTERVAL_MS,
} from "./streamUpdateBatcher";

const assistantDelta = (content: string): ChatMessage => ({
  role: "assistant",
  content,
});

describe("stream update batcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces token deltas and preserves their order", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createStreamUpdateBatcher(onFlush);

    batcher.enqueue([assistantDelta("one")]);
    batcher.enqueue([assistantDelta("two")]);

    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STREAM_UPDATE_INTERVAL_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([
      assistantDelta("one"),
      assistantDelta("two"),
    ]);
  });

  it("flushes immediately when the pending batch reaches its cap", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createStreamUpdateBatcher(onFlush, 1_000, 2);

    batcher.enqueue([assistantDelta("one")]);
    batcher.enqueue([assistantDelta("two")]);

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("can discard pending updates after cancellation", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createStreamUpdateBatcher(onFlush);

    batcher.enqueue([assistantDelta("partial")]);
    batcher.cancel();
    vi.runAllTimers();

    expect(onFlush).not.toHaveBeenCalled();
  });
});
