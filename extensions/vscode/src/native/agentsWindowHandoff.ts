import type { Uri } from "vscode";

export interface AgentsWindowOpenArguments {
  sessionResource: Uri;
}

export function toAgentsWindowOpenArguments(
  resource: Uri | undefined,
): AgentsWindowOpenArguments | undefined {
  return resource ? { sessionResource: resource } : undefined;
}
