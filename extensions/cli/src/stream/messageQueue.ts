import { EventEmitter } from "events";

import type { ChatHistoryItem } from "core";

import type { InputHistory } from "../util/inputHistory.js";
import { logger } from "../util/logger.js";

export interface QueuedMessage {
  message: string;
  imageMap?: Map<string, Buffer>;
  timestamp: number;
  history?: InputHistory;
}

export interface MessageProcessor {
  (message: string, imageMap?: Map<string, Buffer>): Promise<void>;
}

export type SteeringDisposition = "delivered" | "deferred";

interface PendingSteeringMessage {
  message: string;
  resolve: (disposition: SteeringDisposition) => void;
}

interface ActiveTurnState {
  pending: PendingSteeringMessage[];
}

export interface ActiveTurnSteering {
  deliverPending(deliver: (message: string) => void): number;
  close(): void;
}

const CONTINUABLE_TOOL_STATUSES = new Set(["done", "errored"]);

interface SteeringHistoryState {
  history: ChatHistoryItem[];
}

interface SteeringHistoryService {
  addUserMessage(content: string): unknown;
  on(
    event: "stateChanged",
    listener: (state: SteeringHistoryState) => void,
  ): unknown;
  off(
    event: "stateChanged",
    listener: (state: SteeringHistoryState) => void,
  ): unknown;
}

export function isCompletedToolBoundary(history: ChatHistoryItem[]): boolean {
  const latest = history.at(-1);
  const toolCallStates = latest?.toolCallStates;
  return Boolean(
    latest?.message.role === "assistant" &&
      toolCallStates?.length &&
      toolCallStates.every((tool) =>
        CONTINUABLE_TOOL_STATUSES.has(tool.status),
      ),
  );
}

export function attachActiveTurnSteering(
  activeTurn: ActiveTurnSteering,
  historyService: SteeringHistoryService,
): () => void {
  let delivering = false;
  const onStateChanged = (state: SteeringHistoryState) => {
    if (delivering || !isCompletedToolBoundary(state.history)) return;

    delivering = true;
    try {
      activeTurn.deliverPending((message) => {
        historyService.addUserMessage(message);
      });
    } finally {
      delivering = false;
    }
  };

  historyService.on("stateChanged", onStateChanged);
  return () => historyService.off("stateChanged", onStateChanged);
}

/**
 * A queue to store messages that need to be processed later
 */
export class MessageQueue extends EventEmitter {
  private queue: QueuedMessage[] = [];
  private activeTurn?: ActiveTurnState;

  constructor() {
    super();
  }

  async enqueueMessage(
    message: string,
    imageMap?: Map<string, Buffer>,
    history?: InputHistory,
  ): Promise<boolean> {
    const queuedMessage: QueuedMessage = {
      message,
      imageMap,
      timestamp: Date.now(),
      history,
    };

    this.queue.push(queuedMessage);
    logger.debug("MessageQueue: Message queued", {
      queueLength: this.queue.length,
    });

    // Emit event for UI to show the queued message
    this.emit("messageQueued", queuedMessage);

    return true;
  }

  /**
   * Dequeues and returns the next message to be processed (FIFO - oldest first)
   */
  public getNextMessage(): QueuedMessage | undefined {
    return this.queue.shift();
  }

  public async waitForNextMessage(
    timeoutMs: number,
  ): Promise<QueuedMessage | undefined> {
    const queued = this.getNextMessage();
    if (queued) return queued;

    return await new Promise<QueuedMessage | undefined>((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off("messageQueued", onMessageQueued);
      };
      const onMessageQueued = () => {
        cleanup();
        resolve(this.getNextMessage());
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(undefined);
      }, timeoutMs);

      this.once("messageQueued", onMessageQueued);
    });
  }

  /**
   * Holds steering until the active turn reaches a safe provider/tool boundary.
   * The caller must close the handle when that turn can no longer accept input.
   */
  beginActiveTurn(): ActiveTurnSteering {
    if (this.activeTurn) {
      throw new Error("MessageQueue: An active steering turn already exists");
    }

    const state: ActiveTurnState = { pending: [] };
    this.activeTurn = state;

    return {
      deliverPending: (deliver) => {
        if (this.activeTurn !== state) return 0;

        const pending = state.pending.splice(0);
        let delivered = 0;
        for (const item of pending) {
          try {
            deliver(item.message);
            item.resolve("delivered");
            delivered++;
          } catch (error) {
            logger.warn("MessageQueue: Live steering delivery failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            item.resolve("deferred");
          }
        }
        return delivered;
      },
      close: () => {
        if (this.activeTurn !== state) return;

        this.activeTurn = undefined;
        for (const item of state.pending.splice(0)) {
          item.resolve("deferred");
        }
      },
    };
  }

  requestSteering(message: string): Promise<SteeringDisposition> {
    const activeTurn = this.activeTurn;
    if (!activeTurn) return Promise.resolve("deferred");

    return new Promise<SteeringDisposition>((resolve) => {
      activeTurn.pending.push({ message, resolve });
    });
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export const messageQueue = new MessageQueue();
