import { ModelConfig } from "@qivryn/config-yaml";
import { BaseLlmApi } from "@qivryn/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { encode } from "gpt-tokenizer";
import { ChatCompletionTool } from "openai/resources.mjs";

import { streamChatResponse } from "./stream/streamChatResponse.js";
import { StreamCallbacks } from "./stream/streamChatResponse.types.js";
import { logger } from "./util/logger.js";
import {
  countChatHistoryTokens,
  countToolDefinitionTokens,
  countTotalInputTokens,
  getModelContextLimit,
  getModelMaxTokens,
} from "./util/tokenizer.js";

// Buffer cap/ratio for auto-compaction threshold calculation
export const AUTO_COMPACT_BUFFER_CAP = 15_000;
export const AUTO_COMPACT_BUFFER_RATIO = 0.8;
export const AUTO_COMPACT_MIN_NEW_TOKENS = 12_000;
const COMPACTION_MAX_OUTPUT_TOKENS = 8_192;

export interface CompactionResult {
  compactedHistory: ChatHistoryItem[];
  compactionIndex: number;
  compactionContent: string;
}

export interface CompactionCallbacks {
  onStreamContent?: (content: string) => void;
  onStreamComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface CompactionOptions {
  callbacks?: CompactionCallbacks;
  abortController?: AbortController;
  systemMessageTokens?: number;
}

const LOCAL_COMPACTION_MAX_CHARS = 24_000;
const LOCAL_COMPACTION_ITEM_MAX_CHARS = 4_000;

function historyItemExcerpt(item: ChatHistoryItem): string {
  const content =
    typeof item.message.content === "string"
      ? item.message.content
      : JSON.stringify(item.message.content);
  const toolState = (item.toolCallStates ?? [])
    .map((state) => {
      const name = state.toolCall?.function?.name ?? "tool";
      const output = (state.output ?? [])
        .map((entry) => entry.content ?? "")
        .join("\n");
      return `${name} (${state.status})${output ? `: ${output}` : ""}`;
    })
    .join("\n");
  const combined = [content, toolState].filter(Boolean).join("\n");
  if (combined.length <= LOCAL_COMPACTION_ITEM_MAX_CHARS) return combined;
  const half = Math.floor((LOCAL_COMPACTION_ITEM_MAX_CHARS - 120) / 2);
  return `${combined.slice(0, half)}\n[excerpt compacted]\n${combined.slice(-half)}`;
}

/**
 * Last-resort compaction used when a provider rejects the summarization
 * request itself. It preserves the newest actionable transcript excerpts and
 * explicitly directs the agent back to the workspace as the source of truth.
 */
export function createLocalCompactionFallback(
  chatHistory: ChatHistoryItem[],
): CompactionResult {
  const systemMessage = chatHistory.find(
    (item) => item.message.role === "system",
  );
  const selected: string[] = [];
  let usedChars = 0;

  for (let index = chatHistory.length - 1; index >= 0; index--) {
    const item = chatHistory[index];
    if (item.message.role === "system") continue;
    const excerpt = `[${item.message.role}]\n${historyItemExcerpt(item)}`;
    if (
      selected.length > 0 &&
      usedChars + excerpt.length > LOCAL_COMPACTION_MAX_CHARS
    ) {
      break;
    }
    selected.push(excerpt);
    usedChars += excerpt.length;
  }

  const compactionContent = [
    "Automatic local context recovery was used because model-based summarization could not fit in the context window.",
    "Treat the workspace, current diff, tests, and task artifacts as authoritative. Re-inspect them before changing code; omitted transcript details must not be guessed.",
    "Recent transcript excerpts (oldest to newest):",
    ...selected.reverse(),
  ].join("\n\n");
  const compactionMessage: ChatHistoryItem = {
    message: { role: "assistant", content: compactionContent },
    contextItems: [],
    conversationSummary: compactionContent,
  };
  const compactedHistory = systemMessage
    ? [systemMessage, compactionMessage]
    : [compactionMessage];

  return {
    compactedHistory,
    compactionContent,
    compactionIndex: systemMessage ? 1 : 0,
  };
}

const COMPACTION_PROMPT =
  "Please provide a concise summary of our conversation so far, capturing the key context, decisions made, and current state. Format this as a single comprehensive message that preserves all important information needed to continue our work. You do not need to recap the system message, as this will remain. Make sure it is clear what the current stream of work was at the very end prior to compaction so that you can continue exactly where you left off without missing any information.";

const COMPACTION_PROMPT_TOKENS = 150; // rough generous token count of ^

/**
 * Compacts a chat history into a summarized form
 * @param chatHistory The current chat history to compact
 * @param model The model configuration
 * @param llmApi The LLM API instance
 * @param options Optional configuration including callbacks, abort controller, and system message tokens
 * @returns The compacted history with compaction index
 */
export async function compactChatHistory(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  options?: CompactionOptions,
): Promise<CompactionResult> {
  const { callbacks, abortController, systemMessageTokens = 0 } = options || {};
  const compactionModel: ModelConfig = {
    ...model,
    defaultCompletionOptions: {
      ...model.defaultCompletionOptions,
      maxTokens: Math.min(
        getModelMaxTokens(model),
        COMPACTION_MAX_OUTPUT_TOKENS,
      ),
    },
  };
  // Create a prompt to summarize the conversation
  const compactionPrompt: ChatHistoryItem = {
    message: {
      role: "user" as const,
      content: COMPACTION_PROMPT,
    },
    contextItems: [],
  };

  // Check if the history with compaction prompt is too long, prune if necessary
  let historyToUse = chatHistory;
  let historyForCompaction = [...historyToUse, compactionPrompt];

  const contextLimit = getModelContextLimit(compactionModel);
  const maxTokens = getModelMaxTokens(compactionModel);

  // Check if system message is already in the history to avoid double-counting
  const hasSystemMessageInHistory = chatHistory.some(
    (item) => item.message.role === "system",
  );

  // Account for system message (if not already in history) AND compaction prompt
  const systemMessageReservation = hasSystemMessageInHistory
    ? 0
    : systemMessageTokens;

  const availableForInput =
    contextLimit -
    maxTokens -
    systemMessageReservation -
    COMPACTION_PROMPT_TOKENS;

  // Check if we need to prune to fit within context
  while (
    countChatHistoryTokens(historyForCompaction, compactionModel) >
      availableForInput &&
    historyToUse.length > 0
  ) {
    logger.debug("Compaction history too long, pruning last message", {
      tokenCount: countChatHistoryTokens(historyForCompaction, compactionModel),
      availableForInput,
      historyLength: historyToUse.length,
    });
    const prunedHistory = pruneLastMessage(historyToUse);

    // Break if pruning didn't change the history (prevents infinite loop)
    if (prunedHistory.length === historyToUse.length) {
      logger.warn(
        "Cannot prune history further while maintaining valid conversation structure",
      );
      break;
    }

    historyToUse = prunedHistory;
    historyForCompaction = [...historyToUse, compactionPrompt];
  }

  // Stream the compaction response (service drives updates; this collects content locally)
  const controller = abortController || new AbortController();

  let compactionContent = "";
  const streamCallbacks: StreamCallbacks = {
    onContent: (content: string) => {
      compactionContent += content;
      callbacks?.onStreamContent?.(content);
    },
    onContentComplete: () => {
      callbacks?.onStreamComplete?.();
    },
  };

  try {
    await streamChatResponse(
      historyForCompaction,
      compactionModel,
      llmApi,
      controller,
      streamCallbacks,
      true,
    );

    // Create the compacted history with a special marker
    const systemMessage = chatHistory.find(
      (item) => item.message.role === "system",
    );
    const compactionMessage: ChatHistoryItem = {
      message: {
        role: "assistant",
        content: compactionContent,
      },
      contextItems: [],
      conversationSummary: compactionContent,
    };

    const compactedHistory: ChatHistoryItem[] = systemMessage
      ? [systemMessage, compactionMessage]
      : [compactionMessage];

    return {
      compactedHistory,
      compactionContent,
      compactionIndex: systemMessage ? 1 : 0,
    };
  } catch (error) {
    logger.error("Compaction failed", error);
    callbacks?.onError?.(error as Error);
    throw error;
  }
}

/**
 * Finds the compaction index in a chat history
 * @param chatHistory The chat history to search
 * @returns The index of the compaction message, or null if not found
 */
export function findCompactionIndex(
  chatHistory: ChatHistoryItem[],
): number | null {
  const compactedIndex = chatHistory.findIndex(
    (item) => item.conversationSummary !== undefined,
  );
  return compactedIndex === -1 ? null : compactedIndex;
}

/**
 * Gets the history to send to the LLM, taking compaction into account
 * @param fullHistory The complete chat history
 * @param compactionIndex The index of the compaction message, if any
 * @returns The history to send to the LLM
 */
/**
 * Prunes chat history by removing messages from the end while ensuring
 * the history ends with either an assistant message or a tool result message
 * @param chatHistory The chat history to prune
 * @returns The pruned chat history ending with assistant or tool message
 */
export function pruneLastMessage(
  chatHistory: ChatHistoryItem[],
): ChatHistoryItem[] {
  if (chatHistory.length === 0) {
    return chatHistory;
  }

  if (chatHistory.length === 1) {
    // Only one message - always return empty array
    return [];
  }

  const secondToLastIndex = chatHistory.length - 2;
  const secondToLastItem = chatHistory[secondToLastIndex];

  if (
    secondToLastItem.message.role === "assistant" &&
    (secondToLastItem.message as any).toolCalls?.length > 0
  ) {
    return chatHistory.slice(0, -2);
  } else if (secondToLastItem.message.role === "user") {
    return chatHistory.slice(0, -2);
  }

  return chatHistory.slice(0, -1);
}

export function getHistoryForLLM(
  fullHistory: ChatHistoryItem[],
  compactionIndex: number | null,
): ChatHistoryItem[] {
  if (compactionIndex === null || compactionIndex >= fullHistory.length) {
    return fullHistory;
  }

  // Include system message (if at index 0) and everything from compaction index forward
  const systemMessage =
    fullHistory[0]?.message?.role === "system" ? fullHistory[0] : null;
  const messagesFromCompaction = fullHistory.slice(compactionIndex);

  return systemMessage && compactionIndex > 0
    ? [systemMessage, ...messagesFromCompaction]
    : messagesFromCompaction;
}

/**
 * Parameters for auto-compaction check
 */
export interface AutoCompactParams {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  systemMessage?: string;
  tools?: ChatCompletionTool[];
}

/**
 * Get a descriptive message for auto-compaction that shows the context limit
 * @param model The model configuration
 * @returns A descriptive message explaining why compaction is needed
 */
export function getAutoCompactMessage(model: ModelConfig): string {
  const limit = getModelContextLimit(model);
  return `Approaching context limit (${(limit / 1000).toFixed(0)}K tokens). Auto-compacting chat history...`;
}

/**
 * Check if the chat history exceeds the auto-compact threshold.
 * Accounts for system message and tool definitions in the calculation.
 * @param params Object containing chatHistory, model, optional systemMessage, and optional tools
 * @returns Whether auto-compacting should be triggered
 */
export function shouldAutoCompact(params: AutoCompactParams): boolean {
  const { chatHistory, model, systemMessage, tools } = params;

  const inputTokens = countTotalInputTokens({
    chatHistory,
    systemMessage,
    tools,
    model,
  });
  const contextLimit = getModelContextLimit(model);
  const maxTokens = getModelMaxTokens(model);

  // Additional buffer matching the auto-compaction threshold formula
  const ratioCompactionBuffer = Math.ceil(
    (1 - AUTO_COMPACT_BUFFER_RATIO) * (contextLimit - maxTokens),
  );
  const safeCompactionBuffer = Math.max(maxTokens, ratioCompactionBuffer);
  const compactionBuffer = Math.min(
    safeCompactionBuffer,
    AUTO_COMPACT_BUFFER_CAP,
  );

  const compactionThreshold = contextLimit - maxTokens - compactionBuffer;

  // Ensure we have positive space available for input
  if (compactionThreshold <= 0) {
    throw new Error(
      `max_tokens is larger than context_length, which should not be possible. Please check your configuration.`,
    );
  }

  const toolTokens = tools ? countToolDefinitionTokens(tools) : 0;
  const systemTokens = systemMessage ? encode(systemMessage).length : 0;
  const latestCompactionIndex = chatHistory.findLastIndex(
    (item) => item.conversationSummary !== undefined,
  );
  const newTokensSinceCompaction =
    latestCompactionIndex < 0
      ? Number.POSITIVE_INFINITY
      : countChatHistoryTokens(
          chatHistory.slice(latestCompactionIndex + 1),
          model,
        );
  const hasFreshCompaction =
    latestCompactionIndex >= 0 &&
    newTokensSinceCompaction < AUTO_COMPACT_MIN_NEW_TOKENS;
  const shouldCompact =
    inputTokens >= compactionThreshold && !hasFreshCompaction;

  logger.debug("Context usage check", {
    inputTokens,
    historyTokens: countChatHistoryTokens(chatHistory, model),
    systemTokens,
    toolTokens,
    contextLimit,
    maxTokens,
    reservedForOutput: maxTokens,
    compactionBuffer,
    compactionThreshold,
    shouldCompact,
  });

  return shouldCompact;
}
