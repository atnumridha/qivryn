export const targetFile =
  "src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsModel.ts";

const marker = "// Qivryn durable session state";

export function applyNativeAgentSessionState(source) {
  if (source.includes(marker)) return source;
  const importAnchor =
    "import { IChatWidgetService } from '../chat.js';";
  const constructorAnchor =
    "\t\t@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,\n\t) {";
  const stateAnchor = `\tprivate isPinned(session: IInternalAgentSessionData): boolean {
\t\treturn this.resolveStateEntry(session)?.pinned ?? false;
\t}`;
  const pinnedWriteAnchor =
    "\t\tthis.sessionStates.set(session.resource, { ...state, pinned });\n\n\t\tthis._onDidChangeSessions.fire();";
  const unreadAnchor = `\tprivate isMarkedUnread(session: IInternalAgentSessionData): boolean {
\t\treturn this.resolveStateEntry(session)?.read === AgentSessionsModel.UNREAD_MARKER;
\t}`;
  const readAnchor = `\t\tif (this.isArchived(session)) {
\t\t\treturn true; // archived sessions are always read
\t\t}

\t\tconst storedReadDate = this.resolveStateEntry(session)?.read;`;
  const readWriteAnchor =
    "\t\tthis.sessionStates.set(session.resource, { ...state, read: newRead });\n\n\t\tif (!skipEvent) {";
  for (const anchor of [
    importAnchor,
    constructorAnchor,
    stateAnchor,
    pinnedWriteAnchor,
    unreadAnchor,
    readAnchor,
    readWriteAnchor,
  ]) {
    if (!source.includes(anchor)) {
      throw new Error("Could not find the native Agent Sessions state anchor");
    }
  }
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { ICommandService } from '../../../../../platform/commands/common/commands.js';`,
    )
    .replace(
      constructorAnchor,
      `\t\t@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,\n\t\t@ICommandService private readonly commandService: ICommandService,\n\t) {`,
    )
    .replace(
      stateAnchor,
      `\tprivate isPinned(session: IInternalAgentSessionData): boolean {\n\t\t${marker}\n\t\treturn this.resolveStateEntry(session)?.pinned ?? session.metadata?.pinned === true;\n\t}`,
    )
    .replace(
      pinnedWriteAnchor,
      `\t\tthis.sessionStates.set(session.resource, { ...state, pinned });\n\t\tthis.syncQivrynState(session, { pinned });\n\n\t\tthis._onDidChangeSessions.fire();`,
    )
    .replace(
      unreadAnchor,
      `\tprivate isMarkedUnread(session: IInternalAgentSessionData): boolean {\n\t\tconst stored = this.resolveStateEntry(session)?.read;\n\t\treturn stored === AgentSessionsModel.UNREAD_MARKER || (stored === undefined && session.metadata?.unread === true);\n\t}`,
    )
    .replace(
      readAnchor,
      `\t\tif (this.isArchived(session)) {\n\t\t\treturn true; // archived sessions are always read\n\t\t}\n\n\t\tconst storedReadDate = this.resolveStateEntry(session)?.read;\n\t\tif (storedReadDate === undefined && session.metadata?.unread === true) {\n\t\t\treturn false;\n\t\t}`,
    )
    .replace(
      readWriteAnchor,
      `\t\tthis.sessionStates.set(session.resource, { ...state, read: newRead });\n\t\tthis.syncQivrynState(session, { unread: !read });\n\n\t\tif (!skipEvent) {`,
    )
    .replace(
      "\n\tprivate static readonly READ_DATE_BASELINE_KEY",
      `\n\tprivate syncQivrynState(session: IInternalAgentSessionData, state: { pinned?: boolean; unread?: boolean }): void {\n\t\tif (session.providerType !== 'qivryn-agent' || typeof session.metadata?.runId !== 'string') {\n\t\t\treturn;\n\t\t}\n\t\tvoid this.commandService.executeCommand('qivryn.syncNativeAgentState', {\n\t\t\trunId: session.metadata.runId,\n\t\t\t...state,\n\t\t});\n\t}\n\n\tprivate static readonly READ_DATE_BASELINE_KEY`,
    );
}
