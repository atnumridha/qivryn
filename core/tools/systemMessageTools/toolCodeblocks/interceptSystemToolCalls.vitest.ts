import { beforeEach, describe, expect, it } from "vitest";
import {
  CompactSystemMessageToolCodeblocksFramework,
  SystemMessageToolCodeblocksFramework,
} from ".";
import { AssistantChatMessage, ChatMessage, PromptLog } from "../../..";
import { interceptSystemToolCalls } from "../interceptSystemToolCalls";

describe("interceptSystemToolCalls", () => {
  let abortController: AbortController;
  let framework = new SystemMessageToolCodeblocksFramework();

  beforeEach(() => {
    abortController = new AbortController();
  });

  const createAsyncGenerator = async function* (
    messages: ChatMessage[][],
  ): AsyncGenerator<ChatMessage[], PromptLog | undefined> {
    for (const messageGroup of messages) {
      yield messageGroup;
    }
    return undefined;
  };

  const collectMessages = async (
    generator: AsyncGenerator<ChatMessage[], PromptLog | undefined>,
  ): Promise<ChatMessage[]> => {
    const messages: ChatMessage[] = [];
    while (true) {
      const result = await generator.next();
      if (result.done) {
        break;
      }
      messages.push(...(result.value ?? []));
    }
    return messages;
  };

  it("passes through non-assistant messages unchanged", async () => {
    const messages: ChatMessage[][] = [
      [{ role: "user", content: "Hello" }],
      [{ role: "system", content: "System message" }],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    let result = await generator.next();
    expect(result.value).toEqual([{ role: "user", content: "Hello" }]);

    result = await generator.next();
    expect(result.value).toEqual([
      { role: "system", content: "System message" },
    ]);

    result = await generator.next();
    expect(result.done).toBe(true);
  });

  it("passes through assistant messages with existing tool calls", async () => {
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              type: "function",
              function: {
                name: "existing_tool",
                arguments: '{"arg1":"value1"}',
              },
              id: "existing_call_id",
            },
          ],
        },
      ],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    const result = await generator.next();
    expect(result.value).toEqual(messages[0]);
  });

  it("passes through assistant messages with image URLs unchanged", async () => {
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Here's an image:" },
            {
              type: "imageUrl",
              imageUrl: {
                url: "https://example.com/image.png",
              },
            },
          ],
        },
      ],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    const result = await generator.next();
    expect(result.value).toEqual(messages[0]);
  });

  it("processes standard tool call format", async () => {
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content: "I'll help you with that. Let me use a tool:\n",
        },
      ],
      [{ role: "assistant", content: "```tool\n" }],
      [{ role: "assistant", content: "TOOL_NAME: test_tool\n" }],
      [{ role: "assistant", content: "BEGIN_ARG: arg1\n" }],
      [{ role: "assistant", content: "value1\n" }],
      [{ role: "assistant", content: "END_ARG\n" }],
      [{ role: "assistant", content: "```" }],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    // First chunk should be normal text
    let result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "I'll help you with that. Let me use a tool:",
          },
        ],
      },
    ]);

    result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "\n",
          },
        ],
      },
    ]);

    // Tool name detection
    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function?.name,
    ).toBe("test_tool");

    // Begin argument
    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toContain('{"arg1":');

    // Argument value
    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe('"value1"');

    // End of tool call
    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe("}");
  });

  it("processes tool_name without codeblock format", async () => {
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: "I'll help you with that.\n" }],
      [{ role: "assistant", content: "TOOL_NAME: test_tool\n" }],
      [{ role: "assistant", content: "BEGIN_ARG: arg1\n" }],
      [{ role: "assistant", content: "value1\n" }],
      [{ role: "assistant", content: "END_ARG\n" }],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    // First chunk should be normal text
    let result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "I'll help you with that." }],
      },
    ]);

    result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "\n",
          },
        ],
      },
    ]);

    // The system should detect the tool_name format and convert it
    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function?.name,
    ).toBe("test_tool");

    // Rest of processing should work as normal
    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe('{"arg1":');

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe('"value1"');

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe("}");
  });

  it("converts ChatGPT workspace path probe JSON into an ls tool call", async () => {
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: '{"paths":["?"]}' }],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    let result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function?.name,
    ).toBe("ls");

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe('{"dirPath":');

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe('"."');

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe(',"recursive":');

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe("false");

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe("}");

    result = await generator.next();
    expect(result.done).toBe(true);
  });

  it("converts ChatGPT plain bash ls output into an ls tool call", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework();
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: "bash -lc ls\n" }],
      [
        {
          role: "assistant",
          content:
            "I checked the available environment, but I could not identify a workspace.",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      (generatedMessages[0] as AssistantChatMessage).toolCalls?.[0].function
        ?.name,
    ).toBe("ls");
    expect(
      (generatedMessages[1] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('{"dirPath":');
    expect(
      (generatedMessages[2] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('"."');
    expect(
      (generatedMessages[3] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe(',"recursive":');
    expect(
      (generatedMessages[4] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe("false");
    expect(
      (generatedMessages[5] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe("}");
    expect(JSON.stringify(generatedMessages)).not.toContain(
      "could not identify a workspace",
    );
  });

  it("does not convert shell-looking prose glued to ls into a tool call", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework();
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "lsI can investigate the root cause, but I need the codebase first.",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      generatedMessages.some(
        (message) =>
          (message as AssistantChatMessage).toolCalls?.[0].function?.name !==
          undefined,
      ),
    ).toBe(false);
    expect((generatedMessages[0] as AssistantChatMessage).content).toEqual([
      {
        type: "text",
        text: "lsI can investigate the root cause, but I need the codebase first.",
      },
    ]);
  });

  it("converts ChatGPT workspace-unavailable responses into an ls tool call", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework();
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "I can review a workspace when the repository/files are available",
        },
      ],
      [
        {
          role: "assistant",
          content:
            " in the chat environment, but I don't currently have access",
        },
      ],
      [
        {
          role: "assistant",
          content:
            " to any workspace browsing tools or attached project context in this session.\n",
        },
      ],
      [
        {
          role: "assistant",
          content: "Please attach the repository.",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      (generatedMessages[0] as AssistantChatMessage).toolCalls?.[0].function
        ?.name,
    ).toBe("ls");
    expect(
      (generatedMessages[1] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('{"dirPath":');
    expect(
      (generatedMessages[2] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('"."');
    expect(
      (generatedMessages[3] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe(',"recursive":');
    expect(
      (generatedMessages[4] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe("false");
    expect(
      (generatedMessages[5] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe("}");
    expect(JSON.stringify(generatedMessages)).not.toContain(
      "workspace browsing tools",
    );
    expect(JSON.stringify(generatedMessages)).not.toContain(
      "Please attach the repository",
    );
  });

  it("converts ChatGPT workspace-unavailable responses into targeted grep when a query is configured", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework({
      implicitWorkspaceSearchQuery:
        "InventoryAdjustmentExternalService|inventory\\.adjustment\\.confirm",
    });
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "I can investigate this, but I need the relevant code/log context from the workspace to identify the actual root cause.",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );
    const toolDeltas = generatedMessages
      .map((message) => (message as AssistantChatMessage).toolCalls?.[0])
      .filter((delta) => delta !== undefined);
    const args = JSON.parse(
      toolDeltas.map((delta) => delta.function?.arguments ?? "").join(""),
    );

    expect(toolDeltas[0].function?.name).toBe("grep_search");
    expect(args).toEqual({
      query:
        "InventoryAdjustmentExternalService|inventory\\.adjustment\\.confirm",
      output_mode: "files_with_matches",
      head_limit: 50,
      sort: "path",
    });
    expect(JSON.stringify(generatedMessages)).not.toContain(
      "need the relevant code/log context",
    );
  });

  it("converts ungrounded source-bound analysis into targeted grep", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework({
      enableImplicitUngroundedSourceToolCalls: true,
      implicitWorkspaceSearchQuery:
        "InventoryAdjustmentExternalService|ExternalWorkflowValidationResult|success:false",
    });
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "Based on the information provided, the issue does not appear to be a configuration gap. The documented setup suggests the two administration screens are related by the workflow action configuration.",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );
    const toolDeltas = generatedMessages
      .map((message) => (message as AssistantChatMessage).toolCalls?.[0])
      .filter((delta) => delta !== undefined);
    const args = JSON.parse(
      toolDeltas.map((delta) => delta.function?.arguments ?? "").join(""),
    );

    expect(toolDeltas[0].function?.name).toBe("grep_search");
    expect(args).toEqual({
      query:
        "InventoryAdjustmentExternalService|ExternalWorkflowValidationResult|success:false",
      output_mode: "files_with_matches",
      head_limit: 50,
      sort: "path",
    });
    expect(JSON.stringify(generatedMessages)).not.toContain(
      "the issue does not appear to be a configuration gap",
    );
  });

  it("passes through ungrounded source-bound analysis after the guard is disabled", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework({
      enableImplicitUngroundedSourceToolCalls: false,
      implicitWorkspaceSearchQuery:
        "InventoryAdjustmentExternalService|ExternalWorkflowValidationResult",
    });
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "Based on the information provided, the issue does not appear to be a configuration gap.",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(JSON.stringify(generatedMessages)).toContain(
      "the issue does not appear to be a configuration gap",
    );
    expect(
      generatedMessages.some(
        (message) => (message as AssistantChatMessage).toolCalls?.length,
      ),
    ).toBe(false);
  });

  it("converts ChatGPT share-files responses into an ls tool call", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework();
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "I can investigate this, but I need the relevant code/log context from the workspace to identify the actual root cause. I don't have the repository files or runtime traces in this chat yet.",
        },
      ],
      [
        {
          role: "assistant",
          content:
            " For this issue, I would trace the flow in this order:\n\n1. Verify whether the completion event is generated",
        },
      ],
      [
        {
          role: "assistant",
          content: "Please provide:\n- repository path or relevant modules",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      (generatedMessages[0] as AssistantChatMessage).toolCalls?.[0].function
        ?.name,
    ).toBe("ls");
    expect(JSON.stringify(generatedMessages)).not.toContain("Please provide");
    expect(JSON.stringify(generatedMessages)).not.toContain(
      "repository files or runtime traces",
    );
  });

  it("does not repeat workspace-unavailable ls fallback when disabled", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework({
      enableImplicitWorkspaceUnavailableToolCalls: false,
    });
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "I can review a workspace when the repository/files are available",
        },
      ],
      [
        {
          role: "assistant",
          content:
            " in the chat environment, but I don't currently have access",
        },
      ],
      [
        {
          role: "assistant",
          content:
            " to any workspace browsing tools or attached project context in this session.",
        },
      ],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      generatedMessages.some(
        (message) =>
          (message as AssistantChatMessage).toolCalls?.[0].function?.name ===
          "ls",
      ),
    ).toBe(false);
    expect(JSON.stringify(generatedMessages)).toContain(
      "workspace browsing tools",
    );
  });

  it("does not repeat ChatGPT workspace path probe JSON as ls when disabled", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework({
      enableImplicitWorkspaceUnavailableToolCalls: false,
    });
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: '{"paths":["?"]}' }],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      generatedMessages.some(
        (message) =>
          (message as AssistantChatMessage).toolCalls?.[0].function?.name ===
          "ls",
      ),
    ).toBe(false);
    expect((generatedMessages[0] as AssistantChatMessage).content).toEqual([
      { type: "text", text: '{"paths":["?"]}' },
    ]);
  });

  it("still converts plain shell commands when workspace fallback is disabled", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework({
      enableImplicitWorkspaceUnavailableToolCalls: false,
    });
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: 'bash -lc "git status --short"\n' }],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      (generatedMessages[0] as AssistantChatMessage).toolCalls?.[0].function
        ?.name,
    ).toBe("run_terminal_command");
    expect(
      (generatedMessages[1] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('{"command":');
    expect(
      (generatedMessages[2] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('"git status --short"');
  });

  it("converts ChatGPT plain shell commands into terminal tool calls", async () => {
    const compactFramework = new CompactSystemMessageToolCodeblocksFramework();
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: 'bash -lc "git status --short"\n' }],
    ];

    const generatedMessages = await collectMessages(
      interceptSystemToolCalls(
        createAsyncGenerator(messages),
        abortController,
        compactFramework,
      ),
    );

    expect(
      (generatedMessages[0] as AssistantChatMessage).toolCalls?.[0].function
        ?.name,
    ).toBe("run_terminal_command");
    expect(
      (generatedMessages[1] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('{"command":');
    expect(
      (generatedMessages[2] as AssistantChatMessage).toolCalls?.[0].function
        ?.arguments,
    ).toBe('"git status --short"');
  });

  it("preserves content after a tool call", async () => {
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: "```tool\n" }],
      [{ role: "assistant", content: "TOOL_NAME: test_tool\n" }],
      [{ role: "assistant", content: "BEGIN_ARG: arg1\n" }],
      [{ role: "assistant", content: "value1\n" }],
      [{ role: "assistant", content: "END_ARG\n" }],
      [{ role: "assistant", content: "```\n" }],
      [{ role: "assistant", content: "This content should be preserved" }],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    let result;
    // Process through all the tool call deltas (name, arg prefix, arg value, closing brace)
    for (let i = 0; i < 4; i++) {
      result = await generator.next();
    }

    // The trailing newline from "```\n" is yielded as text after the tool call ends
    result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "\n" }],
      },
    ]);

    // The content after the tool call should be preserved
    result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "This content should be preserved" }],
      },
    ]);
  });

  it("parses a tool call that appears mid-message and preserves trailing content", async () => {
    const messages: ChatMessage[][] = [
      [
        {
          role: "assistant",
          content:
            "Before tool\n```tool\nTOOL_NAME: test_tool\nBEGIN_ARG: arg1\nvalue1\nEND_ARG\n```\nAfter tool",
        },
      ],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    let result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Before tool" }],
      },
    ]);

    result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "\n" }],
      },
    ]);

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function?.name,
    ).toBe("test_tool");

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toContain('{"arg1":');

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe('"value1"');

    result = await generator.next();
    expect(
      (result.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe("}");

    // The newline between the closing ``` and "After tool" is a separate chunk
    result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "\n" }],
      },
    ]);

    result = await generator.next();
    expect(result.value).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "After tool" }],
      },
    ]);
  });

  it("stops processing when aborted", async () => {
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: "```tool\n" }],
      [{ role: "assistant", content: "TOOL_NAME: test_tool\n" }],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    // Process the first part
    let result = await generator.next();

    // Abort before processing the second part
    abortController.abort();

    // The next value should be undefined
    result = await generator.next();
    expect(result.value).toBeUndefined();
  });

  it("handles JSON parsing for argument values", async () => {
    const messages: ChatMessage[][] = [
      [{ role: "assistant", content: "```tool\n" }],
      [{ role: "assistant", content: "TOOL_NAME: test_tool\n" }],
      [{ role: "assistant", content: "BEGIN_ARG: number_arg\n" }],
      [{ role: "assistant", content: "123\n" }],
      [{ role: "assistant", content: "END_ARG\n" }],
      [{ role: "assistant", content: "BEGIN_ARG: boolean_arg\n" }],
      [{ role: "assistant", content: "true\n" }],
      [{ role: "assistant", content: "END_ARG\n" }],
      [{ role: "assistant", content: "```" }],
    ];

    const generator = interceptSystemToolCalls(
      createAsyncGenerator(messages),
      abortController,
      framework,
    );

    // Skip to number arg end
    await generator.next();
    await generator.next();
    let result;
    result = await generator.next();

    expect(
      (result?.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe("123");

    // Skip to boolean arg end
    await generator.next();
    result = await generator.next();

    expect(
      (result?.value as AssistantChatMessage[])[0].toolCalls?.[0].function
        ?.arguments,
    ).toBe("true");
  });
});
