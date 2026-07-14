import { ModelConfig } from "@qivryn/config-yaml";
import { BaseLlmApi } from "@qivryn/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { streamChatResponse } from "./streamChatResponse.js";

// Mock all dependencies
vi.mock("../compaction.js", () => ({
  compactChatHistory: vi.fn(),
  pruneLastMessage: vi.fn((history) => history.slice(0, -1)),
  shouldAutoCompact: vi.fn(),
  getAutoCompactMessage: vi.fn(() => "Auto-compacting..."),
}));

vi.mock("../session.js", () => ({
  updateSessionHistory: vi.fn(),
  trackSessionUsage: vi.fn(),
}));

vi.mock("../util/tokenizer.js", () => ({
  countChatHistoryItemTokens: vi.fn(() => 100),
  getModelMaxTokens: vi.fn(() => 2048),
  validateContextLength: vi.fn(() => ({ isValid: true })),
}));

vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: {
    logApiRequest: vi.fn(),
    recordResponseTime: vi.fn(),
    recordTokenUsage: vi.fn(),
    recordCost: vi.fn(),
  },
}));

vi.mock("../util/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../services/index.js", () => ({
  services: {
    systemMessage: {
      getSystemMessage: vi.fn(() => Promise.resolve("System message")),
    },
    toolPermissions: {
      getState: vi.fn(() => ({ currentMode: "enabled" })),
      isHeadless: vi.fn(() => false),
    },
    chatHistory: {
      isReady: vi.fn(() => true),
      getHistory: vi.fn(() => []),
      setHistory: vi.fn(),
      addUserMessage: vi.fn(),
    },
  },
}));

vi.mock("./handleToolCalls.js", () => ({
  handleToolCalls: vi.fn(() => Promise.resolve(false)),
  getRequestTools: vi.fn(() => Promise.resolve([])),
}));

vi.mock("./streamChatResponse.compactionHelpers.js", () => ({
  handlePreApiCompaction: vi.fn((chatHistory) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
  handlePostToolValidation: vi.fn((_, chatHistory) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
  handleNormalAutoCompaction: vi.fn((chatHistory) =>
    Promise.resolve({ chatHistory, wasCompacted: false }),
  ),
}));

describe("streamChatResponse - compaction request control", () => {
  const mockModel: ModelConfig = {
    provider: "openai",
    name: "gpt-4",
    model: "gpt-4",
    defaultCompletionOptions: {
      contextLength: 8192,
      maxTokens: 2048,
    },
  } as any;

  let mockLlmApi: BaseLlmApi;
  let mockAbortController: AbortController;
  let chatHistory: ChatHistoryItem[];
  let chunks: ChatCompletionChunk[];
  let responseCount: number;

  function contentChunk(content: string): ChatCompletionChunk {
    return {
      id: "test",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "test-model",
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
        },
      ],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    responseCount = 0;
    chunks = [contentChunk("Initial response")];
    chatHistory = convertToUnifiedHistory([{ role: "user", content: "Hello" }]);

    mockLlmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        responseCount++;
        for (const chunk of chunks) {
          yield chunk;
        }
      }),
    } as unknown as BaseLlmApi;

    mockAbortController = {
      signal: { aborted: false },
      abort: vi.fn(),
    } as unknown as AbortController;
  });

  it("forces one compaction and bounds provider recovery to one retry", async () => {
    const { services } = await import("../services/index.js");
    const { handlePreApiCompaction } = await import(
      "./streamChatResponse.compactionHelpers.js"
    );
    let apiCalls = 0;
    mockLlmApi = {
      chatCompletionStream: vi.fn().mockImplementation(async function* () {
        apiCalls++;
        if (apiCalls === 1) {
          throw new Error("maximum context length exceeded");
        }
        yield contentChunk(apiCalls === 2 ? "Recovered" : "Continued");
      }),
    } as unknown as BaseLlmApi;
    vi.mocked(handlePreApiCompaction).mockImplementation(
      async (history, options) => ({
        chatHistory: history,
        wasCompacted: options.force === true,
      }),
    );
    const response = await streamChatResponse(
      chatHistory,
      mockModel,
      mockLlmApi,
      mockAbortController,
    );

    expect(apiCalls).toBe(2);
    expect(handlePreApiCompaction).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ force: true }),
    );
    expect(services.chatHistory.addUserMessage).not.toHaveBeenCalled();
    expect(response).toContain("Recovered");
  });

  it("does not synthesize a continuation after compaction", async () => {
    const { services } = await import("../services/index.js");
    const { handleNormalAutoCompaction } = await import(
      "./streamChatResponse.compactionHelpers.js"
    );
    // Track history modifications
    const historyUpdates: string[] = [];
    vi.mocked(services.chatHistory.addUserMessage).mockImplementation((msg) => {
      historyUpdates.push(msg);
      return {
        message: { role: "user", content: msg },
        contextItems: [],
      };
    });

    vi.mocked(handleNormalAutoCompaction).mockImplementation(() => {
      return Promise.resolve({
        chatHistory,
        wasCompacted: true,
      });
    });

    let callCount = 0;
    mockLlmApi.chatCompletionStream = vi
      .fn()
      .mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          // First call: just content, no tool calls (shouldContinue = false)
          yield contentChunk("First response");
        }
      }) as any;

    await streamChatResponse(
      chatHistory,
      mockModel,
      mockLlmApi,
      mockAbortController,
    );

    expect(historyUpdates).not.toContain("qivryn");
    expect(callCount).toBe(1);
  });

  it("should not auto-qivryn if compaction occurs with tool calls pending", async () => {
    const { services } = await import("../services/index.js");
    const { handleNormalAutoCompaction } = await import(
      "./streamChatResponse.compactionHelpers.js"
    );
    const { handleToolCalls } = await import("./handleToolCalls.js");

    const historyUpdates: string[] = [];
    vi.mocked(services.chatHistory.addUserMessage).mockImplementation((msg) => {
      historyUpdates.push(msg);
      return {
        message: { role: "user", content: msg },
        contextItems: [],
      };
    });

    // Compaction happens
    vi.mocked(handleNormalAutoCompaction).mockResolvedValue({
      chatHistory,
      wasCompacted: true,
    });

    // But tool calls are still being processed (shouldContinue = true)
    // This is simulated by having handleToolCalls return true (shouldReturn)
    vi.mocked(handleToolCalls).mockResolvedValue(true);

    // Mock tool calls in response
    mockLlmApi.chatCompletionStream = vi
      .fn()
      .mockImplementation(async function* () {
        yield {
          id: "test",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    type: "function",
                    function: {
                      name: "ReadFile",
                      arguments: '{"filepath": "/test"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
      }) as any;

    await streamChatResponse(
      chatHistory,
      mockModel,
      mockLlmApi,
      mockAbortController,
    );

    // Should NOT auto-qivryn because tool calls are pending
    expect(historyUpdates).not.toContain("qivryn");
  });

  it("does not loop when compaction completes a content-only turn", async () => {
    const { services } = await import("../services/index.js");
    const { handleNormalAutoCompaction } = await import(
      "./streamChatResponse.compactionHelpers.js"
    );

    const historyUpdates: string[] = [];
    vi.mocked(services.chatHistory.addUserMessage).mockImplementation((msg) => {
      historyUpdates.push(msg);
      return {
        message: { role: "user", content: msg },
        contextItems: [],
      };
    });

    vi.mocked(handleNormalAutoCompaction).mockImplementation(() => {
      return Promise.resolve({
        chatHistory,
        wasCompacted: true,
      });
    });

    let streamCallCount = 0;
    mockLlmApi.chatCompletionStream = vi
      .fn()
      .mockImplementation(async function* () {
        streamCallCount++;
        yield contentChunk(`Response ${streamCallCount}`);
      }) as any;

    await streamChatResponse(
      chatHistory,
      mockModel,
      mockLlmApi,
      mockAbortController,
    );

    const qivrynCount = historyUpdates.filter((msg) => msg === "qivryn").length;
    expect(qivrynCount).toBe(0);
    expect(streamCallCount).toBe(1);
  });

  it("uses one isolated request with zero tools and no shared-history access", async () => {
    const { services } = await import("../services/index.js");
    const { handleToolCalls } = await import("./handleToolCalls.js");
    const { handlePreApiCompaction, handleNormalAutoCompaction } = await import(
      "./streamChatResponse.compactionHelpers.js"
    );
    let capturedRequest: any;
    const isolatedApi = {
      chatCompletionStream: vi
        .fn()
        .mockImplementation(async function* (request) {
          capturedRequest = request;
          yield contentChunk("Summary");
        }),
    } as unknown as BaseLlmApi;
    const originalHistory = structuredClone(chatHistory);

    const response = await streamChatResponse(
      chatHistory,
      mockModel,
      isolatedApi,
      mockAbortController,
      { onContent: vi.fn() },
      true,
    );

    expect(response).toBe("Summary");
    expect(isolatedApi.chatCompletionStream).toHaveBeenCalledTimes(1);
    expect(capturedRequest.tools).toEqual([]);
    expect(chatHistory).toEqual(originalHistory);
    expect(services.chatHistory.getHistory).not.toHaveBeenCalled();
    expect(services.chatHistory.setHistory).not.toHaveBeenCalled();
    expect(services.chatHistory.addUserMessage).not.toHaveBeenCalled();
    expect(handleToolCalls).not.toHaveBeenCalled();
    expect(handlePreApiCompaction).not.toHaveBeenCalled();
    expect(handleNormalAutoCompaction).not.toHaveBeenCalled();
  });
});
