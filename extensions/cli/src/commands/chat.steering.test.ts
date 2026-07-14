import { EventEmitter } from "node:events";

import type { ChatHistoryItem } from "core";
import { describe, expect, it, vi } from "vitest";

import {
  getInteractiveStdinDevice,
  openInteractiveStdin,
} from "../stream/agentEventStream.js";
import {
  attachActiveTurnSteering,
  MessageQueue,
} from "../stream/messageQueue.js";

function toolBoundaryHistory(statuses: string[]): ChatHistoryItem[] {
  return [
    {
      message: {
        role: "assistant",
        content: "",
      },
      contextItems: [],
      toolCallStates: statuses.map((status, index) => ({
        toolCallId: `tool-${index}`,
        toolCall: {
          id: `tool-${index}`,
          type: "function",
          function: { name: "test_tool", arguments: "{}" },
        },
        status,
        parsedArgs: {},
      })),
    },
  ] as ChatHistoryItem[];
}

class FakeHistoryService extends EventEmitter {
  readonly delivered: string[] = [];

  addUserMessage(message: string): void {
    this.delivered.push(message);
    this.emit("stateChanged", {
      history: [
        {
          message: { role: "user", content: message },
          contextItems: [],
        },
      ],
    });
  }

  update(history: ChatHistoryItem[]): void {
    this.emit("stateChanged", { history });
  }
}

describe("active-turn steering", () => {
  it("injects steering after every tool in the current batch is terminal", async () => {
    const queue = new MessageQueue();
    const activeTurn = queue.beginActiveTurn();
    const history = new FakeHistoryService();
    const detach = attachActiveTurnSteering(activeTurn, history);
    const delivery = queue.requestSteering("focus on the failed assertion");

    history.update(toolBoundaryHistory(["done", "calling"]));
    await Promise.resolve();
    expect(history.delivered).toEqual([]);

    history.update(toolBoundaryHistory(["done", "errored"]));

    await expect(delivery).resolves.toBe("delivered");
    expect(history.delivered).toEqual(["focus on the failed assertion"]);
    detach();
    activeTurn.close();
  });

  it("does not treat a final assistant response as a tool boundary", async () => {
    const queue = new MessageQueue();
    const activeTurn = queue.beginActiveTurn();
    const history = new FakeHistoryService();
    const detach = attachActiveTurnSteering(activeTurn, history);
    const delivery = queue.requestSteering("run this next");

    history.update([
      {
        message: { role: "assistant", content: "Finished" },
        contextItems: [],
      },
    ] as ChatHistoryItem[]);
    detach();
    activeTurn.close();

    await expect(delivery).resolves.toBe("deferred");
    expect(history.delivered).toEqual([]);
  });

  it("defers when a canceled tool makes the headless turn return", async () => {
    const queue = new MessageQueue();
    const activeTurn = queue.beginActiveTurn();
    const history = new FakeHistoryService();
    const detach = attachActiveTurnSteering(activeTurn, history);
    const delivery = queue.requestSteering("retry with a different tool");

    history.update(toolBoundaryHistory(["done", "canceled"]));
    detach();
    activeTurn.close();

    await expect(delivery).resolves.toBe("deferred");
    expect(history.delivered).toEqual([]);
  });
});

describe("interactive stdin", () => {
  it("uses the Windows console input device for redirected stdin", () => {
    const stream = {} as NodeJS.ReadStream;
    const open = vi.fn(() => 42);
    const createReadStream = vi.fn(() => stream);

    expect(openInteractiveStdin("win32", { open, createReadStream })).toBe(
      stream,
    );
    expect(getInteractiveStdinDevice("win32")).toBe("CONIN$");
    expect(open).toHaveBeenCalledWith("CONIN$", "r");
    expect(createReadStream).toHaveBeenCalledWith(42);
  });

  it("uses the controlling terminal on POSIX", () => {
    const stream = {} as NodeJS.ReadStream;
    const open = vi.fn(() => 7);

    expect(
      openInteractiveStdin("linux", {
        open,
        createReadStream: () => stream,
      }),
    ).toBe(stream);
    expect(getInteractiveStdinDevice("darwin")).toBe("/dev/tty");
    expect(open).toHaveBeenCalledWith("/dev/tty", "r");
  });

  it("closes the terminal descriptor if stream construction fails", () => {
    const close = vi.fn();

    expect(() =>
      openInteractiveStdin("linux", {
        open: () => 9,
        createReadStream: () => {
          throw new Error("not a tty");
        },
        close,
      }),
    ).toThrow("not a tty");
    expect(close).toHaveBeenCalledWith(9);
  });
});
