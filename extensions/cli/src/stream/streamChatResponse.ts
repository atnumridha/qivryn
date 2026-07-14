import { ModelConfig } from "@qivryn/config-yaml";
import { BaseLlmApi } from "@qivryn/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import {
  convertFromUnifiedHistory,
  convertFromUnifiedHistoryWithSystemMessage,
} from "core/util/messageConversion.js";
import * as dotenv from "dotenv";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources.mjs";

import { services } from "../services/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { applyChatCompletionToolOverrides } from "../tools/applyToolOverrides.js";
import { ToolCall } from "../tools/index.js";
import {
  chatCompletionStreamWithBackoff,
  isContextLengthError,
  withExponentialBackoff,
} from "../util/exponentialBackoff.js";
import { logger } from "../util/logger.js";
import { validateContextLength } from "../util/tokenizer.js";

import { getRequestTools, handleToolCalls } from "./handleToolCalls.js";
import {
  handleNormalAutoCompaction,
  handlePostToolValidation,
  handlePreApiCompaction,
} from "./streamChatResponse.compactionHelpers.js";
import {
  processChunkContent,
  processToolCallDelta,
  recordStreamTelemetry,
  trackFirstTokenTime,
} from "./streamChatResponse.helpers.js";
import {
  getDefaultCompletionOptions,
  StreamCallbacks,
} from "./streamChatResponse.types.js";

dotenv.config();

function updateFinalResponse(
  content: string,
  shouldContinue: boolean,
  isHeadless: boolean,
  currentFinalResponse: string,
): string {
  if (!shouldContinue) {
    return content;
  } else if (isHeadless && content) {
    return content;
  }
  return currentFinalResponse;
}

function handleContentDisplay(
  content: string,
  callbacks: StreamCallbacks | undefined,
  isHeadless: boolean,
): void {
  // Add newline after content if needed
  if (!callbacks?.onContent && !isHeadless && content) {
    logger.info("");
  }

  // Notify content complete
  if (content && callbacks?.onContentComplete) {
    callbacks.onContentComplete(content);
  }
}

// Helper function to refresh chat history from service
function refreshChatHistoryFromService(
  chatHistory: ChatHistoryItem[],
  isCompacting: boolean,
): ChatHistoryItem[] {
  const chatHistorySvc = services.chatHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    try {
      // use chat history from params when isCompacting is true
      // otherwise use the full history
      if (!isCompacting) {
        return chatHistorySvc.getHistory();
      }
    } catch {}
  }
  return chatHistory;
}

// Helper function to process a single chunk
interface ProcessChunkOptions {
  chunk: any;
  aiResponse: string;
  toolCallsMap: Map<string, ToolCall>;
  indexToIdMap: Map<number, string>;
  callbacks?: StreamCallbacks;
  isHeadless?: boolean;
}

function processChunk(options: ProcessChunkOptions): {
  aiResponse: string;
  shouldContinue: boolean;
} {
  const {
    chunk,
    aiResponse,
    toolCallsMap,
    indexToIdMap,
    callbacks,
    isHeadless,
  } = options;
  // Safety check: ensure chunk has the expected structure
  if (!chunk.choices || !chunk.choices[0]) {
    return { aiResponse, shouldContinue: true };
  }

  const choice = chunk.choices[0];
  if (!choice.delta) {
    return { aiResponse, shouldContinue: true };
  }

  let updatedResponse = aiResponse;

  // Handle content streaming
  if (choice.delta.content) {
    updatedResponse = processChunkContent(
      choice.delta.content,
      aiResponse,
      callbacks,
      isHeadless,
    );
  }

  // Handle tool calls
  if (choice.delta.tool_calls) {
    for (const toolCallDelta of choice.delta.tool_calls) {
      processToolCallDelta(toolCallDelta, toolCallsMap, indexToIdMap);
    }
  }

  return { aiResponse: updatedResponse, shouldContinue: true };
}

interface ProcessStreamingResponseOptions {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  llmApi: BaseLlmApi;
  abortController: AbortController;
  callbacks?: StreamCallbacks;
  isHeadless?: boolean;
  tools?: ChatCompletionTool[];
  systemMessage?: string;
}

// Process a single streaming response and return whether we need to continue
// eslint-disable-next-line max-statements
export async function processStreamingResponse(
  options: ProcessStreamingResponseOptions,
): Promise<{
  content: string;
  finalContent: string; // Added field for final content only
  toolCalls: ToolCall[];
  shouldContinue: boolean;
  usage?: any;
}> {
  const {
    model,
    llmApi,
    abortController,
    callbacks,
    isHeadless,
    tools,
    systemMessage,
  } = options;

  const chatHistory = options.chatHistory;

  // Safety buffer to account for tokenization estimation errors
  const SAFETY_BUFFER = 100;

  // Validate context length INCLUDING system message and tools
  const validation = validateContextLength({
    chatHistory,
    model,
    safetyBuffer: SAFETY_BUFFER,
    systemMessage,
    tools,
  });

  if (!validation.isValid) {
    throw new Error(`Context length validation failed: ${validation.error}`);
  }

  // Isolated requests can carry their own system item in history instead of
  // consulting or injecting the shared runtime system message.
  const openaiChatHistory = (
    systemMessage === undefined
      ? convertFromUnifiedHistory(chatHistory)
      : convertFromUnifiedHistoryWithSystemMessage(chatHistory, systemMessage)
  ) as ChatCompletionMessageParam[];
  const requestStartTime = Date.now();

  const streamFactory = async (retryAbortSignal: AbortSignal) => {
    logger.debug("Creating chat completion stream", {
      model,
      messageCount: chatHistory.length,
      toolCount: tools?.length || 0,
    });
    return await chatCompletionStreamWithBackoff(
      llmApi,
      {
        model: model.model,
        messages: openaiChatHistory,
        stream: true,
        tools,
        ...getDefaultCompletionOptions(
          model.defaultCompletionOptions,
          validation.maxTokens,
        ),
      },
      retryAbortSignal,
    );
  };

  let aiResponse = "";
  let finalContent = "";
  const toolCallsMap = new Map<string, ToolCall>();
  const indexToIdMap = new Map<number, string>(); // Track index to ID mapping
  let firstTokenTime: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let fullUsage: any = null;

  try {
    const streamWithBackoff = withExponentialBackoff(
      streamFactory,
      abortController.signal,
    );

    let chunkCount = 0;
    for await (const chunk of streamWithBackoff) {
      chunkCount++;

      logger.debug("Received chunk", { chunkCount, chunk });

      // Track token usage if available
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || 0;
        fullUsage = chunk.usage; // Capture full usage including cache details
      }

      // Check if we should abort
      if (abortController?.signal.aborted) {
        logger.debug("Stream aborted");
        break;
      }

      // Track first token time
      firstTokenTime = trackFirstTokenTime(
        firstTokenTime,
        chunk,
        requestStartTime,
        model,
        tools,
      );

      const result = processChunk({
        chunk,
        aiResponse,
        toolCallsMap,
        indexToIdMap,
        callbacks,
        isHeadless,
      });
      aiResponse = result.aiResponse;
      if (!result.shouldContinue) break;
    }

    const responseEndTime = Date.now();
    const cost = recordStreamTelemetry({
      requestStartTime,
      responseEndTime,
      inputTokens,
      outputTokens,
      model,
      tools,
      fullUsage,
    });
    const totalDuration = responseEndTime - requestStartTime;

    // Enhance fullUsage with model and cost for saving to session
    if (fullUsage) {
      fullUsage.model = model.model;
      fullUsage.cost_cents = Math.round(cost * 100); // Convert dollars to cents
    }

    logger.debug("Stream complete", {
      chunkCount,
      responseLength: aiResponse.length,
      toolCallsCount: toolCallsMap.size,
      inputTokens,
      outputTokens,
      cacheReadTokens: fullUsage?.prompt_tokens_details?.cache_read_tokens,
      cacheWriteTokens: fullUsage?.prompt_tokens_details?.cache_write_tokens,
      cost,
      duration: totalDuration,
    });
  } catch (error: any) {
    const errorDuration = Date.now() - requestStartTime;

    // Log failed API request
    telemetryService.logApiRequest({
      model: model.model,
      durationMs: errorDuration,
      success: false,
      error: error.message || String(error),
    });

    if (error.name === "AbortError" || abortController?.signal.aborted) {
      logger.debug("Stream aborted by user");
      return {
        content: aiResponse,
        finalContent: aiResponse,
        toolCalls: [],
        shouldContinue: false,
        usage: fullUsage,
      };
    }

    // Handle context length errors with helpful message
    if (isContextLengthError(error)) {
      logger.debug(`Context length exceeded: ${error}`);
      throw new Error(`Context length exceeded: ${error}`);
    }

    throw error;
  }

  const toolCalls = Array.from(toolCallsMap.values());

  // Validate tool calls have complete arguments
  const validToolCalls = toolCalls.filter((tc) => {
    if (!tc.name) {
      logger.error("Incomplete tool call", {
        id: tc.id,
        name: tc.name,
        hasArguments: !!tc.arguments,
        argumentsStr: tc.argumentsStr,
      });
      return false;
    }
    return true;
  });

  // Always preserve the content - it should be displayed regardless of tool calls
  finalContent = aiResponse;

  return {
    content: aiResponse,
    finalContent: finalContent,
    toolCalls: validToolCalls,
    shouldContinue: validToolCalls.length > 0,
    usage: fullUsage,
  };
}

/**
 * Run one request against caller-owned history without tools, shared-history
 * writes, auto-compaction, or conversation continuation.
 */
export async function streamIsolatedChatResponse(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  abortController: AbortController,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const result = await processStreamingResponse({
    chatHistory: [...chatHistory],
    model,
    llmApi,
    abortController,
    callbacks,
    isHeadless: true,
    tools: [],
    systemMessage: undefined,
  });

  callbacks?.onContentComplete?.(result.content);
  return result.content;
}

// Main function that handles the conversation loop
// eslint-disable-next-line max-params
export async function streamChatResponse(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  abortController: AbortController,
  callbacks?: StreamCallbacks,
  isCompacting = false,
) {
  logger.debug("streamChatResponse called", {
    model,
    historyLength: chatHistory.length,
    hasCallbacks: !!callbacks,
  });

  if (isCompacting) {
    return streamIsolatedChatResponse(
      chatHistory,
      model,
      llmApi,
      abortController,
      callbacks,
    );
  }

  const isHeadless = services.toolPermissions.isHeadless();

  let fullResponse = "";
  let finalResponse = "";

  while (true) {
    // If ChatHistoryService is available, refresh local chatHistory view
    chatHistory = refreshChatHistoryFromService(chatHistory, isCompacting);
    logger.debug("Starting conversation iteration");

    // Get system message once per iteration (can change based on tool permissions mode)
    const systemMessage = await services.systemMessage.getSystemMessage(
      services.toolPermissions.getState().currentMode,
    );

    // Recompute tools on each iteration to handle mode changes during streaming
    const rawTools = await getRequestTools(isHeadless);
    const tools = applyChatCompletionToolOverrides(
      rawTools,
      model.chatOptions?.toolOverrides,
    );

    // Pre-API auto-compaction checkpoint (now includes tools)
    const preCompactionResult = await handlePreApiCompaction(chatHistory, {
      model,
      llmApi,
      isCompacting,
      isHeadless,
      callbacks,
      systemMessage,
      tools,
    });
    chatHistory = preCompactionResult.chatHistory;

    logger.debug("Tools prepared", {
      toolCount: tools.length,
      toolNames: tools.map((t) => t.function.name),
    });

    // Get a response from the LLM. Provider-side tokenizers can disagree with
    // our estimator, so recover once with forced compaction instead of failing
    // an otherwise healthy durable run.
    const requestOptions = {
      isHeadless,
      chatHistory,
      model,
      llmApi,
      abortController,
      callbacks,
      tools,
      systemMessage,
    };
    let streamingResult;
    try {
      streamingResult = await processStreamingResponse(requestOptions);
    } catch (error) {
      if (isCompacting || !isContextLengthError(error)) throw error;

      logger.warn(
        "Provider rejected estimated context size; forcing compaction and retrying once",
      );
      const recovery = await handlePreApiCompaction(chatHistory, {
        isHeadless,
        model,
        llmApi,
        isCompacting,
        callbacks,
        systemMessage,
        tools,
        force: true,
      });
      if (!recovery.wasCompacted) throw error;

      chatHistory = recovery.chatHistory;
      streamingResult = await processStreamingResponse({
        ...requestOptions,
        chatHistory,
      });
    }
    const { content, toolCalls, shouldContinue, usage } = streamingResult;

    if (abortController?.signal.aborted) {
      return finalResponse || content || fullResponse;
    }

    fullResponse += content;

    // Update final response based on mode
    finalResponse = updateFinalResponse(
      content,
      shouldContinue,
      isHeadless,
      finalResponse,
    );

    // Handle content display
    handleContentDisplay(content, callbacks, isHeadless);

    // Handle tool calls and check for early return. This updates history via ChatHistoryService.
    const shouldReturn = await handleToolCalls({
      toolCalls,
      chatHistory,
      content,
      callbacks,
      isHeadless,
      usage,
    });

    if (shouldReturn) {
      return finalResponse || content || fullResponse;
    }

    // After tool execution, validate that we haven't exceeded context limit
    const postToolResult = await handlePostToolValidation(
      toolCalls,
      chatHistory,
      {
        model,
        llmApi,
        isCompacting,
        isHeadless,
        callbacks,
        systemMessage,
        tools,
      },
    );
    chatHistory = postToolResult.chatHistory;

    // Normal auto-compaction check at 80% threshold
    const compactionResult = await handleNormalAutoCompaction(
      chatHistory,
      shouldContinue,
      {
        model,
        llmApi,
        isCompacting,
        isHeadless,
        callbacks,
        systemMessage,
        tools,
      },
    );
    chatHistory = compactionResult.chatHistory;
    if (!shouldContinue) {
      break;
    }
  }

  logger.debug("streamChatResponse complete", {
    totalResponseLength: fullResponse.length,
    totalMessages: chatHistory.length,
  });

  // For headless mode, we return only the final response
  // Otherwise, return the full response
  return isHeadless ? finalResponse : fullResponse;
}
