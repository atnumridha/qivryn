import type { ChatHistoryItem } from "core";
import { chatMessageIsEmpty } from "core/llm/messages";

export const GUI_AUTO_COMPACTION_THRESHOLD = 0.8;

/** Find a stable completed response that is safe to use as a summary boundary. */
export function getManualCompactionTarget(
  history: ChatHistoryItem[],
  requestedIndex = history.length - 1,
): number | undefined {
  for (
    let index = Math.min(requestedIndex, history.length - 1);
    index >= 0;
    index--
  ) {
    const message = history[index].message;
    if (
      message.role === "assistant" &&
      !message.toolCalls?.length &&
      !chatMessageIsEmpty(message)
    ) {
      return index;
    }
  }
  return undefined;
}

/** Keep the active user turn intact and summarize only completed turns. */
export function getAutoCompactionTarget(
  history: ChatHistoryItem[],
  contextPercentage?: number,
  isPruned = false,
): number | undefined {
  if (
    !isPruned &&
    (contextPercentage === undefined ||
      contextPercentage < GUI_AUTO_COMPACTION_THRESHOLD)
  ) {
    return undefined;
  }

  let latestSummary = -1;
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].conversationSummary !== undefined) {
      latestSummary = index;
      break;
    }
  }
  // The final two entries are normally the active user prompt and its empty
  // assistant response. Walk backward to the newest completed assistant turn.
  for (let index = history.length - 3; index > latestSummary; index--) {
    const message = history[index].message;
    if (message.role === "assistant" && !chatMessageIsEmpty(message)) {
      return index;
    }
  }
  return undefined;
}
