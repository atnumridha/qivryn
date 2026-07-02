import { describe, expect, it } from "vitest";

import {
  chatCompletionToCodexOptions,
  chatMessagesToCodexBody,
} from "./ChatGPTCodex.js";

describe("chatMessagesToCodexBody", () => {
  it("preserves matching function calls and outputs", () => {
    const body = chatMessagesToCodexBody("gpt-5.6-sol", [
      { role: "system", content: "Use tools when needed." },
      { role: "user", content: "Review the repository." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc123",
            type: "function",
            function: { name: "list_files", arguments: '{"path":"."}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_abc123",
        content: "README.md",
      },
    ]);

    expect(body.instructions).toBe("Use tools when needed.");
    expect(body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call",
          call_id: "call_abc123",
          name: "list_files",
        }),
        {
          type: "function_call_output",
          call_id: "call_abc123",
          output: "README.md",
        },
      ]),
    );
  });

  it("drops orphaned tool outputs from compacted history", () => {
    const body = chatMessagesToCodexBody("gpt-5.6-sol", [
      {
        role: "tool",
        tool_call_id: "call_removed_by_compaction",
        content: "stale output",
      },
      { role: "user", content: "Continue from the summary." },
    ]);

    expect(body.input).not.toContainEqual(
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_removed_by_compaction",
      }),
    );
    expect(body.input).toContainEqual(
      expect.objectContaining({ type: "message", role: "user" }),
    );
  });
});

describe("chatCompletionToCodexOptions", () => {
  it("omits the unsupported max_output_tokens field", () => {
    const options = chatCompletionToCodexOptions({
      max_tokens: 37_141,
      temperature: 0.2,
      reasoning_effort: "high",
    });

    expect(options).toEqual({
      stream: true,
      temperature: 0.2,
      reasoning: { effort: "high" },
    });
    expect(options).not.toHaveProperty("max_output_tokens");
  });
});
