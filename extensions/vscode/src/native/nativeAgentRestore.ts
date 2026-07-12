import type { AgentRun } from "@qivryn/agent-runtime";

export const NATIVE_AGENT_LAST_RUN_KEY = "qivryn.nativeAgent.lastRunId";
export const NATIVE_AGENT_HANDOFF_RUN_KEY = "qivryn.nativeAgent.handoffRunId";

export function selectNativeAgentRestoreRun(
  runs: readonly AgentRun[],
  preferredRunIds: readonly (string | undefined)[],
): AgentRun | undefined {
  const availableRuns = runs.filter(
    (run) => run.status !== "archived" && run.archived !== true,
  );
  for (const runId of preferredRunIds) {
    if (!runId) continue;
    const preferred = availableRuns.find((run) => run.id === runId);
    if (preferred) return preferred;
  }
  return availableRuns[0];
}
