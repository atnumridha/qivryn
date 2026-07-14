import type { Uri } from "vscode";

export interface AgentsWindowOpenArguments {
  sessionResource: Uri;
}

export function toAgentsWindowOpenArguments(
  resource: Uri | undefined,
): AgentsWindowOpenArguments | undefined {
  return resource ? { sessionResource: resource } : undefined;
}

export function toAgentsWebviewRoute(resource: Uri | undefined): string {
  const encodedRunId = resource?.path.replace(/^\/+/, "");
  if (!encodedRunId) return "/";

  let runId = encodedRunId;
  try {
    runId = decodeURIComponent(encodedRunId);
  } catch {
    // Preserve malformed legacy IDs and let the webview request them verbatim.
  }
  return `/?agentRunId=${encodeURIComponent(runId)}`;
}
