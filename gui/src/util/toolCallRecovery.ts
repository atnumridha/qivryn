import type { ChatHistoryItem, ToolStatus } from "core";
import {
  limitPromptLogsForHistory,
  limitToolContextItemsForHistory,
} from "./historyPayloadLimits";

const INTERRUPTED_TOOL_STATUSES = new Set<ToolStatus>([
  "generating",
  "generated",
  "calling",
]);

export function hasActiveToolCalls(item: ChatHistoryItem): boolean {
  return Boolean(
    item.toolCallStates?.some((state) =>
      INTERRUPTED_TOOL_STATUSES.has(state.status),
    ),
  );
}

function limitPersistedPayloads(item: ChatHistoryItem): {
  promptLogs: ChatHistoryItem["promptLogs"];
  toolCallStates: ChatHistoryItem["toolCallStates"];
  changed: boolean;
} {
  let changed = false;

  const promptLogs = item.promptLogs
    ? limitPromptLogsForHistory(item.promptLogs)
    : item.promptLogs;
  if (
    item.promptLogs &&
    promptLogs?.some(
      (log, index) =>
        log.prompt !== item.promptLogs?.[index]?.prompt ||
        log.completion !== item.promptLogs?.[index]?.completion,
    )
  ) {
    changed = true;
  }

  const toolCallStates = item.toolCallStates?.map((state) => {
    if (!state.output) {
      return state;
    }

    const output = limitToolContextItemsForHistory(state.output);
    const outputChanged = output.some(
      (contextItem, index) =>
        contextItem.content !== state.output?.[index]?.content ||
        contextItem.description !== state.output?.[index]?.description,
    );
    if (!outputChanged) {
      return state;
    }

    changed = true;
    return { ...state, output };
  });

  return { promptLogs, toolCallStates, changed };
}

/**
 * An extension-host restart destroys the stream and executor that own transient
 * tool states. Persisting them as active leaves edit cards spinning forever.
 * Preserve the audit trail while making the session safe to continue.
 */
export function recoverInterruptedHistory(
  history: ChatHistoryItem[],
): ChatHistoryItem[] {
  return history.map((item) => {
    const hasInterruptedTool = hasActiveToolCalls(item);
    const hasInterruptedReasoning = item.reasoning?.active === true;
    const boundedPayloads = limitPersistedPayloads(item);
    if (
      !hasInterruptedTool &&
      !hasInterruptedReasoning &&
      !item.isGatheringContext &&
      !boundedPayloads.changed
    ) {
      return item;
    }

    return {
      ...item,
      isGatheringContext: false,
      reasoning: hasInterruptedReasoning
        ? {
            ...item.reasoning!,
            active: false,
            endAt: item.reasoning!.endAt ?? Date.now(),
          }
        : item.reasoning,
      promptLogs: boundedPayloads.promptLogs,
      toolCallStates: boundedPayloads.toolCallStates?.map((state) =>
        INTERRUPTED_TOOL_STATUSES.has(state.status)
          ? { ...state, status: "canceled" as const }
          : state,
      ),
    };
  });
}
