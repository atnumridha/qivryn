import type { ChatHistoryItem, ToolStatus } from "core";

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
    if (
      !hasInterruptedTool &&
      !hasInterruptedReasoning &&
      !item.isGatheringContext
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
      toolCallStates: item.toolCallStates?.map((state) =>
        INTERRUPTED_TOOL_STATUSES.has(state.status)
          ? { ...state, status: "canceled" as const }
          : state,
      ),
    };
  });
}
