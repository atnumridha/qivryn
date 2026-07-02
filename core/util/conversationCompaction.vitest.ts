import type { ChatHistoryItem } from "..";
import { describe, expect, it, vi } from "vitest";
import { compactConversation } from "./conversationCompaction";

const item = (
  role: "user" | "assistant",
  content: string,
): ChatHistoryItem => ({
  message: { role, content },
  contextItems: [],
});

describe("compactConversation", () => {
  it("does not replay tool output from before the next user boundary", async () => {
    const history: ChatHistoryItem[] = [
      item("user", "old prompt"),
      {
        ...item("assistant", "old response"),
        conversationSummary: "Existing summary",
      },
      {
        message: {
          role: "tool",
          content: "orphaned output",
          toolCallId: "removed-call",
        },
        contextItems: [],
      },
      item("assistant", "old continuation"),
      item("user", "new prompt"),
      item("assistant", "new response"),
    ];
    const save = vi.fn();
    const chat = vi.fn().mockResolvedValue({
      role: "assistant",
      content: "Updated summary",
    });

    await compactConversation({
      sessionId: "session-1",
      index: 5,
      historyManager: { load: () => ({ history }), save } as any,
      currentModel: { chat } as any,
    });

    const sentMessages = chat.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(sentMessages.some((message) => message.role === "tool")).toBe(false);
    expect(sentMessages.map((message) => message.content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Existing summary"),
        "new prompt",
        "new response",
      ]),
    );
    expect(save).toHaveBeenCalledOnce();
  });

  it("summarizes only the prior summary when an autonomous tool chain has no new user boundary", async () => {
    const history: ChatHistoryItem[] = [
      item("user", "original prompt"),
      {
        ...item("assistant", "tool-using response"),
        conversationSummary: "Stable prior summary",
      },
      {
        message: {
          role: "tool",
          content: "old tool output",
          toolCallId: "call_from_summarized_turn",
        },
        contextItems: [],
      },
      {
        message: {
          role: "assistant",
          content: "autonomous continuation",
          toolCalls: [
            {
              id: "later_call",
              type: "function",
              function: { name: "read_file", arguments: "{}" },
            },
          ],
        },
        contextItems: [],
      },
      {
        message: {
          role: "tool",
          content: "later output",
          toolCallId: "later_call",
        },
        contextItems: [],
      },
    ];
    const chat = vi.fn().mockResolvedValue({
      role: "assistant",
      content: "Updated summary",
    });

    await compactConversation({
      sessionId: "session-1",
      index: 4,
      historyManager: { load: () => ({ history }), save: vi.fn() } as any,
      currentModel: { chat } as any,
    });

    const sentMessages = chat.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toEqual({
      role: "user",
      content: expect.stringContaining("Stable prior summary"),
    });
    expect(sentMessages[1].role).toBe("user");
  });

  it("rejects a stale history index with an actionable error", async () => {
    await expect(
      compactConversation({
        sessionId: "session-1",
        index: 4,
        historyManager: {
          load: () => ({ history: [item("user", "only")] }),
          save: vi.fn(),
        } as any,
        currentModel: { chat: vi.fn() } as any,
      }),
    ).rejects.toThrow("history index 4 is no longer available");
  });
});
