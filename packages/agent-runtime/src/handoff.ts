import type {
  AgentRun,
  AgentRuntimeAdapter,
  AgentWorkspace,
} from "./contracts.js";

export async function handoffAgentRun(
  source: AgentRuntimeAdapter,
  target: AgentRuntimeAdapter,
  runId: string,
  workspace?: Partial<AgentWorkspace>,
): Promise<AgentRun> {
  const snapshot = await source.exportRun(runId);
  const imported = await target.importRun(snapshot, workspace);
  await source.archiveRun(runId);
  return imported;
}
