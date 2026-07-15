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

  it("sanitizes historical function call names for the Codex backend", () => {
    const body = chatMessagesToCodexBody("gpt-5.6-sol", [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_bugdb",
            type: "function",
            function: {
              name: "bugdb.lookup.issue/with:scope",
              arguments: "{}",
            },
          },
        ],
      },
    ]);

    const functionCall = body.input.find(
      (item: any) => item.type === "function_call",
    );

    expect(functionCall?.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(functionCall?.name).toMatch(
      /^bugdb_lookup_issue_with_scope_[a-f0-9]{8}$/,
    );
  });
});

describe("chatCompletionToCodexOptions", () => {
  it("omits unsupported output and sampling fields", () => {
    const options = chatCompletionToCodexOptions({
      max_tokens: 37_141,
      temperature: 0.2,
      reasoning_effort: "high",
    });

    expect(options).toEqual({
      stream: true,
      reasoning: { effort: "high" },
    });
    expect(options).not.toHaveProperty("max_output_tokens");
    expect(options).not.toHaveProperty("temperature");
  });

  it("sanitizes top-level Responses tool names sent to ChatGPT Codex", () => {
    const options = chatCompletionToCodexOptions({
      tools: [
        {
          type: "function",
          function: {
            name: "bugdb.lookup.issue/with:scope",
            description: "Look up a BugDB issue",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "function",
          name: "browser-recorder.open/page",
          description: "Open a recorded browser page",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(options.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: expect.stringMatching(
          /^bugdb_lookup_issue_with_scope_[a-f0-9]{8}$/,
        ),
      }),
      expect.objectContaining({
        type: "function",
        name: expect.stringMatching(/^browser-recorder_open_page_[a-f0-9]{8}$/),
      }),
    ]);
    expect(
      options.tools?.every((tool: any) => /^[a-zA-Z0-9_-]+$/.test(tool.name)),
    ).toBe(true);
  });
});
