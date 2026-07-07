import type { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import {
  hasActiveToolCalls,
  recoverInterruptedHistory,
} from "./toolCallRecovery";

const interruptedItem: ChatHistoryItem = {
  message: {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "edit-1",
        type: "function",
        function: { name: "edit_file", arguments: "{}" },
      },
    ],
  },
  contextItems: [],
  isGatheringContext: true,
  reasoning: {
    active: true,
    text: "editing",
    startAt: 1,
  },
  toolCallStates: [
    {
      toolCallId: "edit-1",
      toolCall: {
        id: "edit-1",
        type: "function",
        function: { name: "edit_file", arguments: "{}" },
      },
      parsedArgs: {},
      status: "calling",
    },
  ],
};

describe("tool call restart recovery", () => {
  it("cancels transient work and clears loading state", () => {
    expect(hasActiveToolCalls(interruptedItem)).toBe(true);

    const [recovered] = recoverInterruptedHistory([interruptedItem]);

    expect(recovered.toolCallStates?.[0].status).toBe("canceled");
    expect(recovered.isGatheringContext).toBe(false);
    expect(recovered.reasoning?.active).toBe(false);
    expect(recovered.reasoning?.endAt).toEqual(expect.any(Number));
    expect(hasActiveToolCalls(recovered)).toBe(false);
  });

  it("preserves completed tool states without cloning the item", () => {
    const completed = {
      ...interruptedItem,
      isGatheringContext: false,
      reasoning: { ...interruptedItem.reasoning!, active: false, endAt: 2 },
      toolCallStates: interruptedItem.toolCallStates?.map((state) => ({
        ...state,
        status: "done" as const,
      })),
    };

    expect(recoverInterruptedHistory([completed])[0]).toBe(completed);
  });

  it("bounds oversized persisted payloads when a session is restored", () => {
    const oversized: ChatHistoryItem = {
      message: {
        role: "assistant",
        content: "done",
      },
      contextItems: [],
      promptLogs: [
        {
          modelProvider: "test",
          modelTitle: "test-model",
          prompt: "p".repeat(30_000),
          completion: "c".repeat(30_000),
        },
      ],
      toolCallStates: [
        {
          toolCallId: "tool-1",
          toolCall: {
            id: "tool-1",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
          parsedArgs: {},
          status: "done",
          output: [
            {
              name: "Large output",
              description: "Before",
              content: "x".repeat(40_000),
            },
          ],
        },
      ],
    };

    const [recovered] = recoverInterruptedHistory([oversized]);

    expect(recovered).not.toBe(oversized);
    expect(recovered.promptLogs?.[0].prompt.length).toBeLessThan(30_000);
    expect(
      recovered.toolCallStates?.[0].output?.[0].content.length,
    ).toBeLessThan(40_000);
    expect(recovered.toolCallStates?.[0].status).toBe("done");
  });
});
