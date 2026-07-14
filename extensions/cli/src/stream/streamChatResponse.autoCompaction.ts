import { ModelConfig } from "@qivryn/config-yaml";
import { BaseLlmApi } from "@qivryn/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";
import React from "react";

import {
  compactChatHistory,
  createLocalCompactionFallback,
  getAutoCompactMessage,
  shouldAutoCompact,
} from "../compaction.js";
import { services } from "../services/index.js";
import { updateSessionHistory } from "../session.js";
import { formatError } from "../util/formatError.js";
import { logger } from "../util/logger.js";

interface AutoCompactionCallbacks {
  // For streaming mode
  onSystemMessage?: (message: string) => void;
  onContent?: (content: string) => void;
  onCompactionStart?: (message: string) => void;
  onCompactionComplete?: (message: string) => void;
  onRecoveryComplete?: (message: string) => void;

  // For TUI mode
  setMessages?: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>;
  setChatHistory?: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>;
  setCompactionIndex?: React.Dispatch<React.SetStateAction<number | null>>;

  // For headless mode - no callbacks needed, just return values
}

interface AutoCompactionOptions {
  isHeadless?: boolean;
  format?: "json";
  callbacks?: AutoCompactionCallbacks;
  systemMessage?: string;
  tools?: ChatCompletionTool[];
  /** Compact even when the local estimator has not crossed its threshold. */
  force?: boolean;
}

function updateActiveHistory(history: ChatHistoryItem[]): void {
  const chatHistoryService = services.chatHistory;
  if (chatHistoryService?.isReady()) {
    chatHistoryService.setHistory(history);
    return;
  }

  updateSessionHistory(history);
}

/**
 * Notify user about compaction start
 */
function notifyCompactionStart(
  message: string,
  isHeadless: boolean,
  callbacks?: AutoCompactionCallbacks,
) {
  if (callbacks?.onCompactionStart) {
    callbacks.onCompactionStart(message);
  } else if (callbacks?.onSystemMessage) {
    callbacks.onSystemMessage(message);
  } else if (!isHeadless && callbacks?.setMessages) {
    // TUI mode - handled by caller
  }
}

/**
 * Handle successful compaction state updates
 */
function handleCompactionSuccess(
  result: any,
  isHeadless: boolean,
  callbacks?: AutoCompactionCallbacks,
) {
  const successMessage = "Chat history auto-compacted successfully.";
  if (callbacks?.onCompactionComplete) {
    callbacks.onCompactionComplete(successMessage);
  } else if (callbacks?.onSystemMessage) {
    callbacks.onSystemMessage(successMessage);
  } else if (
    !isHeadless &&
    callbacks?.setMessages &&
    callbacks?.setChatHistory &&
    callbacks?.setCompactionIndex
  ) {
    callbacks.setChatHistory(result.compactedHistory);
    callbacks.setCompactionIndex(result.compactionIndex);
    callbacks.setMessages((prev: ChatHistoryItem[]) => [
      ...prev,
      {
        message: {
          role: "system",
          content: successMessage,
        },
        contextItems: [],
      },
    ]);
  }
}

/**
 * Handle compaction error notification
 */
function handleCompactionError(
  error: any,
  isHeadless: boolean,
  callbacks?: AutoCompactionCallbacks,
) {
  const errorMessage = `Auto-compaction error: ${formatError(error)}`;
  logger.error(errorMessage);

  const warningMessage = `Warning: ${errorMessage}. Continuing without compaction...`;

  if (callbacks?.onSystemMessage) {
    callbacks.onSystemMessage(warningMessage);
  } else if (!isHeadless && callbacks?.setMessages) {
    callbacks.setMessages((prev: ChatHistoryItem[]) => [
      ...prev,
      {
        message: {
          role: "system",
          content: warningMessage,
        },
        contextItems: [],
      },
    ]);
  }
}

/**
 * Unified auto-compaction handler for all modes (streaming, TUI, headless)
 * @param chatHistory Current chat history
 * @param model Model configuration
 * @param llmApi LLM API instance
 * @param options Configuration options for different usage contexts
 * @returns Updated chat history and compaction index, or original if no compaction needed
 */
export async function handleAutoCompaction(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  options: AutoCompactionOptions = {},
): Promise<{
  chatHistory: ChatHistoryItem[];
  compactionIndex: number | null;
  wasCompacted: boolean;
}> {
  const {
    isHeadless = false,
    callbacks,
    systemMessage: providedSystemMessage,
    tools,
    force = false,
  } = options;

  if (!model) {
    return { chatHistory, compactionIndex: null, wasCompacted: false };
  }

  if (
    !force &&
    !shouldAutoCompact({
      chatHistory,
      model,
      systemMessage: providedSystemMessage,
      tools,
    })
  ) {
    return { chatHistory, compactionIndex: null, wasCompacted: false };
  }

  logger.info(
    `${force ? "Forced c" : "Auto-c"}ompaction triggered${isHeadless ? " in headless mode" : ""}`,
  );

  // Notify about compaction start
  notifyCompactionStart(getAutoCompactMessage(model), isHeadless, callbacks);

  try {
    // Get system message to calculate its token count for compaction pruning
    // Use provided message if available, otherwise fetch it (for backward compatibility)
    const systemMessage =
      providedSystemMessage ??
      (async () => {
        const { services } = await import("../services/index.js");
        return services.systemMessage.getSystemMessage(
          services.toolPermissions.getState().currentMode,
        );
      })();
    const resolvedSystemMessage =
      typeof systemMessage === "string" ? systemMessage : await systemMessage;

    const { countChatHistoryItemTokens } = await import("../util/tokenizer.js");
    const systemMessageTokens = countChatHistoryItemTokens(
      {
        message: {
          role: "system",
          content: resolvedSystemMessage,
        },
        contextItems: [],
      },
      model,
    );

    // Compact the history
    const result = await compactChatHistory(chatHistory, model, llmApi, {
      callbacks: isHeadless
        ? undefined
        : {
            onStreamContent: callbacks?.onContent,
            onStreamComplete: () => {},
          },
      systemMessageTokens,
      tools,
    });

    // Persist through the active history scope. Subagents use a remote child
    // service here, so their compaction never reaches the parent SessionManager.
    updateActiveHistory(result.compactedHistory);

    // Handle success notification
    handleCompactionSuccess(result, isHeadless, callbacks);

    return {
      chatHistory: result.compactedHistory,
      compactionIndex: result.compactionIndex,
      wasCompacted: true,
    };
  } catch (error: any) {
    if (force) {
      logger.warn(
        "Model-based compaction failed; using bounded local recovery summary",
        error,
      );
      const fallback = createLocalCompactionFallback(chatHistory);
      updateActiveHistory(fallback.compactedHistory);
      const recoveryMessage =
        "Recovered with a bounded local summary and workspace state.";
      if (callbacks?.onRecoveryComplete) {
        callbacks.onRecoveryComplete(recoveryMessage);
      } else {
        callbacks?.onSystemMessage?.(
          "Model-based compaction could not complete. Recovered with a bounded local summary and will continue from the workspace state.",
        );
      }
      return {
        chatHistory: fallback.compactedHistory,
        compactionIndex: fallback.compactionIndex,
        wasCompacted: true,
      };
    }

    handleCompactionError(error, isHeadless, callbacks);

    // Continue without compaction on error
    return { chatHistory, compactionIndex: null, wasCompacted: false };
  }
}
