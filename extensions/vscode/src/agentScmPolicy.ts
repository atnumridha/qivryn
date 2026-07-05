import path from "node:path";
import type { AgentRun } from "@qivryn/agent-runtime";

export interface AgentScmEntry {
  root: string;
  repository: string;
  branch: string;
  runId: string;
  title: string;
}

export function activeAgentScmEntries(runs: AgentRun[]): AgentScmEntry[] {
  const entries = new Map<string, AgentScmEntry>();
  for (const run of runs) {
    if (run.archived || !run.workspace.worktreePath) continue;
    const root = path.resolve(run.workspace.worktreePath);
    entries.set(root, {
      root,
      repository: path.basename(path.resolve(run.workspace.repositoryPath)),
      branch: run.workspace.branch ?? "detached",
      runId: run.id,
      title: run.title,
    });
  }
  return [...entries.values()].sort((left, right) =>
    left.root.localeCompare(right.root),
  );
}

export function activeAgentWorktrees(runs: AgentRun[]): string[] {
  return activeAgentScmEntries(runs).map(({ root }) => root);
}
