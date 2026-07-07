import type { ChatMessage } from "core";

export const STREAM_UPDATE_INTERVAL_MS = 50;
export const MAX_PENDING_STREAM_MESSAGES = 64;

export interface StreamUpdateBatcher {
  enqueue(messages: ChatMessage[]): void;
  flush(): void;
  cancel(): void;
}

/**
 * Coalesces high-frequency model deltas before they enter Redux. Rendering
 * markdown after every token makes long responses progressively more
 * expensive and can starve VS Code's renderer event loop.
 */
export function createStreamUpdateBatcher(
  onFlush: (messages: ChatMessage[]) => void,
  intervalMs = STREAM_UPDATE_INTERVAL_MS,
  maxPendingMessages = MAX_PENDING_STREAM_MESSAGES,
): StreamUpdateBatcher {
  let pending: ChatMessage[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const flush = () => {
    clearTimer();
    if (pending.length === 0) {
      return;
    }

    const messages = pending;
    pending = [];
    onFlush(messages);
  };

  return {
    enqueue(messages) {
      if (messages.length === 0) {
        return;
      }

      pending.push(...messages);
      if (pending.length >= maxPendingMessages) {
        flush();
        return;
      }

      timer ??= setTimeout(flush, intervalMs);
    },
    flush,
    cancel() {
      clearTimer();
      pending = [];
    },
  };
}
