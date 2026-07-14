import { describe, expect, it, vi } from "vitest";

vi.mock("../util/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    configureHeadlessMode: vi.fn(),
    getLogPath: vi.fn(),
    getSessionId: vi.fn(),
  },
}));

import { MessageQueue } from "./messageQueue.js";

describe("messageQueue", () => {
  it("enqueues and emits messageQueued", async () => {
    const messageQueue = new MessageQueue();
    const event = new Promise<any>((resolve) =>
      messageQueue.once("messageQueued", resolve),
    );

    const ok = await messageQueue.enqueueMessage("hello world");
    expect(ok).toBe(true);
    expect(messageQueue.getQueueLength()).toBe(1);

    const queued = await event;
    expect(queued.message).toBe("hello world");
    expect(messageQueue.getNextMessage()?.message).toBe("hello world");
  });

  it("waits briefly for a steering message at the end of a turn", async () => {
    const messageQueue = new MessageQueue();
    const pending = messageQueue.waitForNextMessage(100);
    setTimeout(() => void messageQueue.enqueueMessage("steer now"), 5);

    await expect(pending).resolves.toMatchObject({ message: "steer now" });
    expect(messageQueue.getQueueLength()).toBe(0);
  });

  it("stops waiting when no steering message arrives", async () => {
    const messageQueue = new MessageQueue();
    await expect(messageQueue.waitForNextMessage(5)).resolves.toBeUndefined();
  });

  it("delivers pending steering only when the active turn opens a boundary", async () => {
    const messageQueue = new MessageQueue();
    const activeTurn = messageQueue.beginActiveTurn();
    const delivery = messageQueue.requestSteering("focus on the failing test");
    const deliveredMessages: string[] = [];
    let settled = false;
    void delivery.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(messageQueue.getQueueLength()).toBe(0);

    expect(
      activeTurn.deliverPending((message) => deliveredMessages.push(message)),
    ).toBe(1);
    await expect(delivery).resolves.toBe("delivered");
    expect(deliveredMessages).toEqual(["focus on the failing test"]);
    expect(messageQueue.getQueueLength()).toBe(0);
    activeTurn.close();
  });

  it("defers pending steering without moving it into the ordinary queue", async () => {
    const messageQueue = new MessageQueue();
    const activeTurn = messageQueue.beginActiveTurn();
    const delivery = messageQueue.requestSteering("handle this next");

    activeTurn.close();

    await expect(delivery).resolves.toBe("deferred");
    expect(messageQueue.getQueueLength()).toBe(0);
  });

  it("defers immediately when no active turn can accept steering", async () => {
    const messageQueue = new MessageQueue();

    await expect(messageQueue.requestSteering("too late")).resolves.toBe(
      "deferred",
    );
    expect(messageQueue.getQueueLength()).toBe(0);
  });
});
