export interface AgentWindowRecoveryDependencies {
  cancelApply: () => Promise<void>;
  getCurrentFile: () => Promise<{ path: string } | undefined>;
  getStreamId: (filepath: string) => string | undefined;
  clearDiff: (filepath: string) => void;
  restoreSession: () => Promise<void>;
}

export type AgentWindowEditStateDependencies = Omit<
  AgentWindowRecoveryDependencies,
  "restoreSession"
>;

/** Release any edit owned by a standalone agent window before reloading it. */
export async function releaseAgentWindowEditState(
  dependencies: AgentWindowEditStateDependencies,
): Promise<void> {
  await dependencies.cancelApply();
  const currentFile = await dependencies.getCurrentFile();
  if (currentFile?.path && dependencies.getStreamId(currentFile.path)) {
    dependencies.clearDiff(currentFile.path);
  }
}

/** Release host-side edit state before restoring the chat in the main view. */
export async function recoverClosedAgentWindow(
  dependencies: AgentWindowRecoveryDependencies,
): Promise<void> {
  await releaseAgentWindowEditState(dependencies);
  await dependencies.restoreSession();
}
