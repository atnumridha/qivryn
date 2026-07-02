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
});
