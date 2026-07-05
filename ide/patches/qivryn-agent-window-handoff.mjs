export const targetFile =
  "src/vs/workbench/contrib/chat/electron-browser/agentSessions/agentSessionsActions.ts";

const marker = "// Qivryn native session handoff";

export function applyQivrynAgentWindowHandoff(source) {
  if (source.includes(marker)) return source;
  const anchor = `\t\t\t\t\tContextKeyExpr.or(
\t\t\t\t\t\tChatContextKeys.chatSessionType.isEqualTo(SessionType.CopilotCLI),
\t\t\t\t\t\tChatContextKeys.chatSessionType.isEqualTo(SessionType.AgentHostCopilot),
\t\t\t\t\t),`;
  if (!source.includes(anchor)) {
    throw new Error("Could not find the Agents Window handoff provider anchor");
  }
  return source.replace(
    anchor,
    `\t\t\t\t\tContextKeyExpr.or(\n\t\t\t\t\t\tChatContextKeys.chatSessionType.isEqualTo(SessionType.CopilotCLI),\n\t\t\t\t\t\tChatContextKeys.chatSessionType.isEqualTo(SessionType.AgentHostCopilot),\n\t\t\t\t\t\t${marker}\n\t\t\t\t\t\tChatContextKeys.chatSessionType.isEqualTo('qivryn-agent'),\n\t\t\t\t\t),`,
  );
}
