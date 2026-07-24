import { describe, expect, it } from "vitest";

import {
  CHATGPT_CONVERSATION_ENDPOINTS,
  CHATGPT_REQUIREMENTS_PREPARE_ENDPOINT,
  CHATGPT_STREAM_CONVERSATION_ENDPOINT,
  chatRequirementsHeadersFromResponse,
  chatCompletionToChatGPTConversationRequest,
  chatCompletionToCodexOptions,
  chatMessagesToCodexBody,
  chatGPTStreamHandoffTopicId,
  createChatGPTBrowserHeaders,
  decodeChatGPTConversationEvent,
  parseChatGPTEncodedSseItem,
  resolveEffectiveChatGPTBackendMode,
  resolveChatGPTBackendMode,
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

describe("ChatGPT backend mode", () => {
  it("defaults to the Codex responses backend", () => {
    expect(resolveChatGPTBackendMode(undefined)).toBe("codex");
    expect(resolveChatGPTBackendMode("invalid", undefined)).toBe("codex");
  });

  it("uses the first valid configured backend", () => {
    expect(resolveChatGPTBackendMode("chatgpt", "codex")).toBe("chatgpt");
    expect(resolveChatGPTBackendMode("codex", "chatgpt")).toBe("codex");
    expect(resolveChatGPTBackendMode(undefined, "chatgpt")).toBe("chatgpt");
  });

  it("keeps ChatGPT selectable but proxies tool-capable agent turns through Codex responses", () => {
    expect(
      resolveEffectiveChatGPTBackendMode(
        {
          tools: [
            {
              type: "function",
              function: {
                name: "grep_search",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        },
        "chatgpt",
      ),
    ).toBe("codex");

    expect(
      resolveEffectiveChatGPTBackendMode(
        {
          messages: [{ role: "user", content: "hello" }],
        },
        "chatgpt",
      ),
    ).toBe("chatgpt");
  });

  it("exposes the ChatGPT conversation endpoints from the desktop bundle", () => {
    expect(CHATGPT_CONVERSATION_ENDPOINTS.prepare).toBe(
      "https://chatgpt.com/backend-api/f/conversation/prepare",
    );
    expect(CHATGPT_CONVERSATION_ENDPOINTS.conversation).toBe(
      "https://chatgpt.com/backend-api/f/conversation",
    );
    expect(CHATGPT_CONVERSATION_ENDPOINTS.resume).toBe(
      "https://chatgpt.com/backend-api/f/conversation/resume",
    );
    expect(CHATGPT_CONVERSATION_ENDPOINTS.sidebar).toBe(
      "https://chatgpt.com/backend-api/sidebar/conversation",
    );
    expect(CHATGPT_CONVERSATION_ENDPOINTS.websocketUrl).toBe(
      "https://chatgpt.com/backend-api/celsius/ws/user",
    );
  });

  it("streams ChatGPT backend mode through the ChatGPT conversation endpoint", () => {
    expect(CHATGPT_STREAM_CONVERSATION_ENDPOINT).toBe(
      CHATGPT_CONVERSATION_ENDPOINTS.conversation,
    );
    expect(CHATGPT_REQUIREMENTS_PREPARE_ENDPOINT).toBe(
      "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare",
    );
  });

  it("maps ChatGPT requirements prepare responses to sentinel headers", () => {
    expect(
      chatRequirementsHeadersFromResponse({
        token: "requirements-token",
      }),
    ).toEqual({
      "OpenAI-Sentinel-Chat-Requirements-Token": "requirements-token",
    });

    expect(
      chatRequirementsHeadersFromResponse({
        prepare_token: "prepare-token",
        proofofwork: {
          required: true,
          seed: "seed",
          difficulty: "ffffffff",
        },
      }),
    ).toEqual({
      "OpenAI-Sentinel-Chat-Requirements-Prepare-Token": "prepare-token",
      "OpenAI-Sentinel-Proof-Token": expect.stringMatching(/^gAAAAAB.+~S$/),
    });
  });

  it("adds browser-style headers for ChatGPT backend requests", () => {
    expect(createChatGPTBrowserHeaders("device-1", "darwin")).toMatchObject({
      "OAI-Language": "en",
      "oai-did": "device-1",
      originator: "Codex Browser",
      "User-Agent": expect.stringContaining("Chrome/136.0.0.0"),
      "sec-ch-ua": expect.stringContaining('"Chromium";v="136"'),
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    });
  });

  it("lets a request-level ChatGPT backend override model defaults", () => {
    expect(resolveChatGPTBackendMode("chatgpt", "codex")).toBe("chatgpt");
    expect(resolveChatGPTBackendMode("codex", "chatgpt")).toBe("codex");
  });

  it("decodes ChatGPT conversation reply and completion envelopes", () => {
    expect(
      decodeChatGPTConversationEvent({
        conversation_id: "conversation-1",
        message: {
          id: "message-1",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["hello"] },
        },
      }),
    ).toMatchObject({
      type: "message",
      conversationId: "conversation-1",
      message: {
        author: { role: "assistant" },
      },
    });

    expect(
      decodeChatGPTConversationEvent({
        conversation_id: "conversation-1",
        type: "message_stream_complete",
      }),
    ).toEqual({
      type: "complete",
      conversationId: "conversation-1",
    });
  });

  it("decodes sidebar-style ChatGPT message envelopes", () => {
    expect(
      decodeChatGPTConversationEvent({
        conversation_id: "conversation-1",
        type: "message",
        data: {
          id: "message-1",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["reply"] },
        },
      }),
    ).toMatchObject({
      type: "message",
      conversationId: "conversation-1",
    });
  });

  it("parses handoff stream items back into SSE events", () => {
    const parsed = parseChatGPTEncodedSseItem(
      'event: delta\ndata: {"c":0,"o":"add","p":"","v":{"message":{"author":{"role":"assistant"},"content":{"parts":["hi"]}}}}\n',
    );

    expect(parsed).toEqual({
      event: "delta",
      data: {
        c: 0,
        o: "add",
        p: "",
        v: {
          message: {
            author: { role: "assistant" },
            content: { parts: ["hi"] },
          },
        },
      },
    });
  });

  it("extracts ChatGPT websocket handoff topics", () => {
    expect(
      chatGPTStreamHandoffTopicId({
        type: "stream_handoff",
        turn_exchange_id: "turn-1",
        options: [
          { type: "resume_sse_endpoint" },
          {
            type: "subscribe_ws_topic",
            topic_id: "conversation-abc",
          },
        ],
      }),
    ).toBe("conversation-abc");
  });
});

describe("chatCompletionToChatGPTConversationRequest", () => {
  it("builds a ChatGPT conversation request without changing model text", () => {
    const ids = ["message-1", "message-2", "parent-1"];
    const request = chatCompletionToChatGPTConversationRequest(
      {
        model: "gpt-5.6-sol",
        messages: [
          { role: "system", content: "Use concise answers." },
          { role: "user", content: "Review the repository." },
          { role: "assistant", content: "I will inspect it." },
        ],
        reasoningEffort: "high",
      },
      () => ids.shift() ?? "fallback-id",
    );

    expect(request).toMatchObject({
      action: "next",
      model: "gpt-5.6-sol",
      parent_message_id: "parent-1",
      history_and_training_disabled: true,
      stream: true,
      thinking_effort: "high",
    });
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]).toMatchObject({
      id: "message-1",
      author: { role: "user" },
      content: {
        content_type: "text",
        parts: [expect.stringContaining("Use concise answers.")],
      },
    });
    expect(request.messages[0].content.parts[0]).toContain(
      "Behave as Qivryn's coding agent",
    );
    expect(request.messages[0].content.parts[0]).toContain(
      "Do not ask the user to upload, paste, or share the repository",
    );
    expect(request.messages[0].content.parts[0]).toContain(
      "User message:\nReview the repository.",
    );
    expect(request.messages[1]).toMatchObject({
      id: "message-2",
      author: { role: "assistant" },
      content: {
        content_type: "text",
        parts: ["I will inspect it."],
      },
    });
  });

  it("maps leftover tool outputs to visible user context for ChatGPT conversation", () => {
    const ids = ["message-1", "message-2", "parent-1"];
    const request = chatCompletionToChatGPTConversationRequest(
      {
        model: "gpt-5.6-sol",
        messages: [
          { role: "user", content: "Review the workspace." },
          {
            role: "tool",
            tool_call_id: "call_ls",
            content: "README.md\npackages/",
          },
        ],
      },
      () => ids.shift() ?? "fallback-id",
    );

    expect(request.messages[1]).toMatchObject({
      id: "message-2",
      author: { role: "user" },
      metadata: { qivryn_role: "tool" },
      content: {
        content_type: "text",
        parts: [
          expect.stringContaining(
            "Qivryn local tool result. This is real output from the user's workspace.",
          ),
        ],
      },
    });
    expect(request.messages[1].content.parts[0]).toContain(
      "Tool output (call_ls):\nREADME.md\npackages/",
    );
  });

  it("limits ChatGPT conversation payload while preserving instructions and latest message", () => {
    const longText = "Qivryn listed files in .\n".repeat(1_000);
    const messages = [
      { role: "system", content: "Use Qivryn tools." },
      { role: "user", content: "review the codebase" },
    ];
    for (let index = 0; index < 24; index += 1) {
      messages.push({
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${longText}\nold message ${index}`,
      });
    }
    messages.push({
      role: "user",
      content: `latest request\n${"latest-detail\n".repeat(600)}`,
    });

    const request = chatCompletionToChatGPTConversationRequest(
      {
        model: "gpt-5.6-sol",
        messages,
      },
      () => `id-${Math.random()}`,
    );
    const text = request.messages
      .flatMap((message: any) => message.content.parts)
      .join("\n");
    const requestTextLength = request.messages
      .flatMap((message: any) => message.content.parts)
      .reduce(
        (total: number, part: unknown) =>
          total + (typeof part === "string" ? part.length : 0),
        0,
      );

    expect(request.messages.length).toBeLessThanOrEqual(8);
    expect(requestTextLength).toBeLessThanOrEqual(24_000);
    expect(request.messages[0].content.parts[0]).toContain(
      "Qivryn runtime instructions follow",
    );
    expect(text).toContain("latest request");
    expect(text).toContain("truncated for ChatGPT endpoint payload");
  });

  it("can build a smaller fresh ChatGPT request after a payload rejection", () => {
    const longText = "Qivryn listed files in .\n".repeat(1_000);
    const messages = [
      { role: "system", content: "Use Qivryn tools." },
      { role: "user", content: "review the codebase" },
    ];
    for (let index = 0; index < 16; index += 1) {
      messages.push({
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${longText}\nold message ${index}`,
      });
    }
    messages.push({
      role: "user",
      content: `latest request\n${"latest-detail\n".repeat(600)}`,
    });

    const request = chatCompletionToChatGPTConversationRequest(
      {
        model: "gpt-5.6-sol",
        messages,
      },
      () => `id-${Math.random()}`,
      {
        maxMessages: 4,
        maxTextChars: 12_000,
        maxFirstMessageTextChars: 4_000,
        maxLatestMessageTextChars: 6_000,
        maxRecentMessageTextChars: 1_500,
      },
    );
    const requestTextLength = request.messages
      .flatMap((message: any) => message.content.parts)
      .reduce(
        (total: number, part: unknown) =>
          total + (typeof part === "string" ? part.length : 0),
        0,
      );

    expect(request.messages).toHaveLength(4);
    expect(requestTextLength).toBeLessThanOrEqual(12_000);
    expect(request.messages[0].content.parts[0]).toContain(
      "Qivryn runtime instructions follow",
    );
    expect(request.messages.at(-1)?.content.parts.join("\n")).toContain(
      "latest request",
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
