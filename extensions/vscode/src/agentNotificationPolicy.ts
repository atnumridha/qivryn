import type { AgentRun } from "@continuedev/agent-runtime";

export type AgentNotificationMode = "off" | "whenUnfocused" | "always";

export function shouldNotifyAgent(
  mode: AgentNotificationMode,
  windowFocused: boolean,
): boolean {
  return mode === "always" || (mode === "whenUnfocused" && !windowFocused);
}

export function agentNotificationMessage(
  run: AgentRun,
  includeTaskTitle: boolean,
): string {
  const status =
    run.status === "completed"
      ? "completed"
      : run.status === "attention"
        ? "needs attention"
        : "failed";
  return includeTaskTitle
    ? `${run.title} ${status}`
    : `Continue agent ${status}`;
}
