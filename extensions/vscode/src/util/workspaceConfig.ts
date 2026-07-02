import { workspace } from "vscode";

export const QIVRYN_WORKSPACE_KEY = "qivryn";

export function getQivrynWorkspaceConfig() {
  return workspace.getConfiguration(QIVRYN_WORKSPACE_KEY);
}
