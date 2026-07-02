import path from "node:path";
import type { AgentRun } from "@qivryn/agent-runtime";

export function activeAgentWorktrees(runs: AgentRun[]): string[] {
  return [
    ...new Set(
      runs
        .filter((run) => !run.archived && run.workspace.worktreePath)
        .map((run) => path.resolve(run.workspace.worktreePath!)),
    ),
  ].sort();
}
