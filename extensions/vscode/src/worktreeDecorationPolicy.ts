import path from "node:path";
import type { AgentRun } from "@continuedev/agent-runtime";

export interface WorktreeDecoration {
  runId: string;
  title: string;
  branch?: string;
  root: string;
  colorIndex: number;
}

function normalized(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function worktreeDecorationForFile(
  filepath: string,
  runs: AgentRun[],
): WorktreeDecoration | undefined {
  const file = normalized(filepath);
  const candidates = runs
    .filter((run) => run.workspace.worktreePath)
    .map((run, index) => ({
      run,
      index,
      root: normalized(run.workspace.worktreePath!),
    }))
    .filter(
      ({ root }) => file === root || file.startsWith(`${root}${path.sep}`),
    )
    .sort((a, b) => b.root.length - a.root.length);
  const match = candidates[0];
  if (!match) return undefined;
  return {
    runId: match.run.id,
    title: match.run.title,
    branch: match.run.workspace.branch,
    root: match.run.workspace.worktreePath!,
    colorIndex: match.index % 6,
  };
}
