export const viewerCssTarget =
  "src/vs/workbench/contrib/chat/browser/agentSessions/media/agentsessionsviewer.css";
export const viewerTarget =
  "src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsViewer.ts";
export const chatCssTarget =
  "src/vs/workbench/contrib/chat/browser/widget/media/chat.css";
export const sessionTransportTarget =
  "src/vs/workbench/api/common/extHostChatSessions.ts";
export const chatListRendererTarget =
  "src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts";
export const chatWidgetTarget =
  "src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts";

const cssMarker = "/* Qivryn native agent sessions */";
const chatCssMarker = "/* Qivryn Codie-density native transcript */";
const viewerDensityMarker = "// Qivryn Codie-density agent rows";
const sessionHeaderTransportMarker =
  "// Qivryn native session header transport";
const sessionHeaderRendererMarker = "// Qivryn native session header marker";
const sessionHeaderRequestMarker =
  "// Qivryn session header marker renders as the original prompt";
const initialScrollMarker = "// Qivryn native sessions open at transcript top";
const restoredScrollMarker =
  "// Qivryn restored native sessions open at transcript top";

const qivrynAgentSessionsCss = `

${cssMarker}
.agent-sessions-viewer {
	--qivryn-agent-row-radius: 6px;
	--qivryn-agent-row-padding-x: 8px;
	--qivryn-agent-row-padding-y: 4px;
	--qivryn-agent-sidebar-width: 256px;
	font-size: 12px;
}

.agent-sessions-workbench .agent-sessions-viewer {
	min-width: 214px;
	width: 100%;
}

.agent-sessions-viewer .monaco-list-row {
	border-radius: var(--qivryn-agent-row-radius);
}

.agent-sessions-viewer .agent-session-item {
	box-sizing: border-box;
	gap: 12px;
	min-height: 44px;
	padding: 6px var(--qivryn-agent-row-padding-x);
}

.agent-sessions-viewer .agent-session-title-row {
	line-height: 16px;
	padding-bottom: 0;
}

.agent-sessions-viewer .agent-session-title {
	font-size: 12px;
	font-weight: 500;
}

.agent-sessions-viewer .agent-session-details-row {
	font-size: 11px;
	line-height: 14px;
	opacity: .72;
}

.agent-sessions-viewer .monaco-list-row:hover:not(.selected):not(.focused) {
	background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
}

.agent-sessions-viewer .monaco-list-row.selected,
.agent-sessions-viewer .monaco-list-row.focused {
	background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
}

.agent-sessions-viewer .agent-session-section {
	color: var(--vscode-descriptionForeground);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: .04em;
	text-transform: uppercase;
}

.agent-sessions-viewer > .monaco-list > .monaco-scrollable-element {
	padding: 0 8px !important;
}

.agent-sessions-viewer .agent-session-icon-col {
	width: 14px;
}

.agent-sessions-viewer .agent-session-icon-col .agent-session-icon {
	font-size: 9px !important;
	height: 14px !important;
	width: 14px;
}

.agent-sessions-viewer .agent-session-main-col {
	gap: 2px;
	padding-left: 2px !important;
}

.agent-sessions-viewer .agent-session-title-row {
	height: 16px;
}

.agent-sessions-viewer .agent-session-details-row {
	height: 14px;
}

.agent-sessions-viewer .agent-session-section {
	height: 24px;
	padding: 0 6px !important;
}

.agent-sessions-viewer .agent-session-approval-row {
	border-color: var(--vscode-input-border, var(--vscode-widget-border));
	border-radius: 6px;
	background: var(--vscode-input-background);
}

.interactive-session .chat-input-container,
.interactive-session .chat-input-part {
	border-radius: 8px;
}
`;

export function applyNativeAgentSessionsCss(source) {
  const markerIndex = source.indexOf(cssMarker);
  if (markerIndex >= 0) {
    return `${source.slice(0, markerIndex).trimEnd()}${qivrynAgentSessionsCss}\n`;
  }
  return `${source.trimEnd()}${qivrynAgentSessionsCss}\n`;
}

export function applyNativeAgentSessionsViewer(source) {
  const marker = "return localize('agentSessions', \"Agents\");";
  let transformed = source;
  if (!transformed.includes(marker)) {
    const original = "return localize('agentSessions', \"Agent Sessions\");";
    if (!transformed.includes(original)) {
      throw new Error("Could not find the Agent Sessions accessibility label");
    }
    transformed = transformed.replace(original, marker);
  }
  if (!transformed.includes(viewerDensityMarker)) {
    transformed = transformed.replace(
      "\tstatic readonly ITEM_HEIGHT = 54;\n\tstatic readonly SECTION_HEIGHT = 26;",
      `\t${viewerDensityMarker}\n\tstatic readonly ITEM_HEIGHT = 44;\n\tstatic readonly SECTION_HEIGHT = 24;`,
    );
  }
  if (
    transformed.includes("\tprivate static readonly CAPPED_SESSIONS_LIMIT = 3;")
  ) {
    transformed = transformed.replace(
      "\tprivate static readonly CAPPED_SESSIONS_LIMIT = 3;",
      "\tprivate static readonly CAPPED_SESSIONS_LIMIT = 12;",
    );
  }
  if (
    transformed.includes("\t\tresult.push(...pinnedSessions, ...topUnpinned);")
  ) {
    transformed = transformed.replace(
      "\t\tresult.push(...pinnedSessions, ...topUnpinned);",
      `\t\tif (pinnedSessions.length > 0) {\n\t\t\tresult.push({ section: AgentSessionSection.Pinned, label: AgentSessionSectionLabels[AgentSessionSection.Pinned], sessions: pinnedSessions });\n\t\t}\n\t\tif (topUnpinned.length > 0) {\n\t\t\tresult.push({ section: AgentSessionSection.Today, label: localize('qivryn.agentSessions.recentSection', "Recent"), sessions: topUnpinned });\n\t\t}`,
    );
  }
  return transformed;
}

const qivrynNativeChatCss = `

${chatCssMarker}
.monaco-workbench .interactive-session {
	--qivryn-transcript-width: 760px;
	--qivryn-composer-width: 780px;
	background: var(--vscode-editor-background);
	max-width: none;
}

.monaco-workbench .interactive-session > .interactive-list {
	box-sizing: border-box;
	margin: 0 auto;
	max-width: var(--qivryn-transcript-width);
	width: 100%;
}

.monaco-workbench .interactive-session .interactive-item-container {
	color: var(--vscode-foreground);
	font-size: 12px;
	padding: 8px 20px;
}

.monaco-workbench .interactive-session .interactive-item-container .header {
	display: none !important;
}

.monaco-workbench .interactive-session .interactive-item-container .header .avatar {
	height: 18px;
	width: 18px;
}

.monaco-workbench .interactive-session .interactive-item-container .header .avatar .icon {
	height: 18px;
	width: 18px;
}

.monaco-workbench .interactive-session .interactive-item-container .header .username {
	font-size: 12px;
	font-weight: 500;
}

.monaco-workbench .interactive-session .interactive-item-container .value .rendered-markdown {
	font-size: 12px;
	line-height: 1.55;
}

.monaco-workbench .interactive-session .interactive-item-container .value > .rendered-markdown p {
	margin-bottom: 10px;
}

.monaco-workbench .interactive-session .interactive-item-container.interactive-request .value {
	background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
	border: 1px solid color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
	border-radius: 8px;
	margin-left: auto;
	max-width: 82%;
	padding: 8px 12px;
	width: fit-content;
}

.monaco-workbench .interactive-session .interactive-item-container.interactive-request .header {
	display: none;
}

.monaco-workbench .interactive-session .interactive-item-container.qivryn-session-preamble-request {
	display: none !important;
	height: 0 !important;
	min-height: 0 !important;
	padding: 0 !important;
}

.monaco-workbench .interactive-session .interactive-item-container .value > .chat-tool-invocation-part {
	background: color-mix(in srgb, var(--vscode-foreground) 3%, transparent);
	border: 1px solid color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
	border-radius: 6px;
	margin: 4px 0;
	padding: 6px 8px;
}

.monaco-workbench .interactive-session > .interactive-input-part {
	box-sizing: border-box;
	margin: 0 auto;
	max-width: var(--qivryn-composer-width);
	padding: 10px 16px 14px;
	width: 100%;
}

.monaco-workbench .interactive-session .chat-input-container {
	background: color-mix(in srgb, var(--vscode-input-background) 94%, transparent);
	border-color: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
	border-radius: 8px;
	box-shadow: 0 8px 24px color-mix(in srgb, var(--vscode-widget-shadow) 35%, transparent);
	min-height: 92px;
	padding: 2px 8px 8px;
}

.monaco-workbench .interactive-session .chat-input-container.focused {
	border-color: color-mix(in srgb, var(--vscode-focusBorder) 72%, transparent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 20%, transparent), 0 10px 28px color-mix(in srgb, var(--vscode-widget-shadow) 40%, transparent);
}

.monaco-workbench .interactive-session .chat-input-toolbars {
	gap: 4px;
	margin-top: 6px;
}

.monaco-workbench .interactive-session .chat-input-toolbar .chat-input-picker-item .action-label,
.monaco-workbench .interactive-session .chat-input-toolbar .chat-sessionPicker-item .action-label {
	border-radius: 5px;
	font-size: 11px;
	height: 18px;
}

.monaco-workbench .interactive-session .chat-input-toolbars > .chat-execute-toolbar .monaco-action-bar .action-item:has(> .action-label.codicon-arrow-up) > .action-label.codicon-arrow-up {
	border-radius: 6px;
	height: 24px;
	width: 34px;
}

@media (max-width: 760px) {
	.monaco-workbench .interactive-session > .interactive-input-part {
		padding-inline: 12px;
	}

	.monaco-workbench .interactive-session .interactive-item-container {
		padding-inline: 14px;
	}
}
`;

export function applyNativeAgentChatCss(source) {
  const markerIndex = source.indexOf(chatCssMarker);
  if (markerIndex >= 0) {
    return `${source.slice(0, markerIndex).trimEnd()}${qivrynNativeChatCss}\n`;
  }
  return `${source.trimEnd()}${qivrynNativeChatCss}\n`;
}

export function applyNativeSessionHeaderTransport(source) {
  if (source.includes(sessionHeaderTransportMarker)) return source;
  const anchor = `\t\t\tmodelId: turn.modelId,
\t\t\tmodeInstructions: typeConvert.ChatRequestModeInstructions.from(turn.modeInstructions2),`;
  if (!source.includes(anchor)) {
    throw new Error("Pinned Code - OSS session transport anchor not found");
  }
  return source.replace(
    anchor,
    `\t\t\tmodelId: turn.modelId,
\t\t\t${sessionHeaderTransportMarker}
\t\t\tisSystemInitiated: (turn as extHostTypes.ChatRequestTurn & { isSystemInitiated?: boolean }).isSystemInitiated,
\t\t\tsystemInitiatedLabel: (turn as extHostTypes.ChatRequestTurn & { systemInitiatedLabel?: string }).systemInitiatedLabel,
\t\t\tmodeInstructions: typeConvert.ChatRequestModeInstructions.from(turn.modeInstructions2),`,
  );
}

export function applyNativeSessionHeaderRenderer(source) {
  let transformed = source;
  const identityAnchor = `\t\tconst isSystemInitiatedRequest = isRequestVM(element) && !!element.isSystemInitiated;`;
  if (!transformed.includes(sessionHeaderRequestMarker)) {
    if (!transformed.includes(identityAnchor)) {
      throw new Error(
        "Pinned Code - OSS session header identity anchor not found",
      );
    }
    transformed = transformed.replace(
      identityAnchor,
      `\t\t${sessionHeaderRequestMarker}
\t\tconst isSystemInitiatedRequest = isRequestVM(element) && !!element.isSystemInitiated && element.systemInitiatedLabel !== 'qivryn.session.header';`,
    );
  }

  if (transformed.includes(sessionHeaderRendererMarker)) {
    const collapsedBlock = `\t\t${sessionHeaderRendererMarker}
\t\tconst isQivrynSessionHeader = element.isSystemInitiated && element.systemInitiatedLabel === 'qivryn.session.header';
\t\ttemplateData.rowContainer.classList.toggle('qivryn-session-header-request', isQivrynSessionHeader);
\t\tif (isQivrynSessionHeader) {
\t\t\tdom.clearNode(templateData.value);
\t\t\tif (templateData.renderedParts) {
\t\t\t\tdispose(templateData.renderedParts);
\t\t\t}
\t\t\ttemplateData.renderedParts = [];
\t\t\treturn;
\t\t}

\t\t// System-initiated requests render as compact progress-style messages
\t\tif (element.isSystemInitiated) {`;
    const visibleBlock = `\t\t${sessionHeaderRendererMarker}
\t\tconst isQivrynSessionHeader = element.isSystemInitiated && element.systemInitiatedLabel === 'qivryn.session.header';
\t\ttemplateData.rowContainer.classList.toggle('qivryn-session-header-request', isQivrynSessionHeader);

\t\t// System-initiated requests render as compact progress-style messages
\t\tif (element.isSystemInitiated && !isQivrynSessionHeader) {`;
    const desiredBlock = `\t\t${sessionHeaderRendererMarker}
\t\tconst isQivrynSessionPreamble = index === 0
\t\t\t&& getChatSessionType(element.sessionResource) === 'qivryn-agent'
\t\t\t&& !element.messageText.trim()
\t\t\t&& element.variables.length === 0;
\t\ttemplateData.rowContainer.classList.toggle('qivryn-session-preamble-request', isQivrynSessionPreamble);
\t\tif (isQivrynSessionPreamble) {
\t\t\tdom.clearNode(templateData.value);
\t\t\tif (templateData.renderedParts) {
\t\t\t\tdispose(templateData.renderedParts);
\t\t\t}
\t\t\ttemplateData.renderedParts = [];
\t\t\treturn;
\t\t}
\t\tconst isQivrynSessionHeader = element.isSystemInitiated && element.systemInitiatedLabel === 'qivryn.session.header';
\t\ttemplateData.rowContainer.classList.toggle('qivryn-session-header-request', isQivrynSessionHeader);

\t\t// System-initiated requests render as compact progress-style messages
\t\tif (element.isSystemInitiated && !isQivrynSessionHeader) {`;
    if (transformed.includes(desiredBlock)) {
      return transformed;
    }
    if (transformed.includes(collapsedBlock)) {
      transformed = transformed.replace(collapsedBlock, desiredBlock);
    } else if (transformed.includes(visibleBlock)) {
      transformed = transformed.replace(visibleBlock, desiredBlock);
    } else {
      throw new Error(
        "Pinned Code - OSS existing Qivryn session header renderer block not found",
      );
    }
    return transformed;
  }
  const anchor = `\t\ttemplateData.rowContainer.classList.toggle('system-initiated-request', !!element.isSystemInitiated);

\t\t// System-initiated requests render as compact progress-style messages
\t\tif (element.isSystemInitiated) {`;
  if (!transformed.includes(anchor)) {
    throw new Error(
      "Pinned Code - OSS session header renderer anchor not found",
    );
  }
  return transformed.replace(
    anchor,
    `\t\ttemplateData.rowContainer.classList.toggle('system-initiated-request', !!element.isSystemInitiated);
\t\t${sessionHeaderRendererMarker}
\t\tconst isQivrynSessionPreamble = index === 0
\t\t\t&& getChatSessionType(element.sessionResource) === 'qivryn-agent'
\t\t\t&& !element.messageText.trim()
\t\t\t&& element.variables.length === 0;
\t\ttemplateData.rowContainer.classList.toggle('qivryn-session-preamble-request', isQivrynSessionPreamble);
\t\tif (isQivrynSessionPreamble) {
\t\t\tdom.clearNode(templateData.value);
\t\t\tif (templateData.renderedParts) {
\t\t\t\tdispose(templateData.renderedParts);
\t\t\t}
\t\t\ttemplateData.renderedParts = [];
\t\t\treturn;
\t\t}
\t\tconst isQivrynSessionHeader = element.isSystemInitiated && element.systemInitiatedLabel === 'qivryn.session.header';
\t\ttemplateData.rowContainer.classList.toggle('qivryn-session-header-request', isQivrynSessionHeader);

\t\t// System-initiated requests render as compact progress-style messages
\t\tif (element.isSystemInitiated && !isQivrynSessionHeader) {`,
  );
}

export function applyNativeAgentInitialScroll(source) {
  let transformed = source;
  const initialAnchor = `\t\tif (this.viewModel) {
\t\t\tthis.onDidChangeItems();
\t\t\tthis.listWidget.scrollToEnd();
\t\t}`;
  if (!transformed.includes(initialScrollMarker)) {
    if (!transformed.includes(initialAnchor)) {
      throw new Error("Pinned Code - OSS initial chat scroll anchor not found");
    }
    transformed = transformed.replace(
      initialAnchor,
      `\t\tif (this.viewModel) {
\t\t\tthis.onDidChangeItems();
\t\t\t${initialScrollMarker}
\t\t\tif (getChatSessionType(this.viewModel.sessionResource) === 'qivryn-agent') {
\t\t\t\tthis.listWidget.scrollTop = 0;
\t\t\t} else {
\t\t\t\tthis.listWidget.scrollToEnd();
\t\t\t}
\t\t}`,
    );
  }

  const restoredAnchor = `\t\tif (this.listWidget && this.visible) {
\t\t\tthis.onDidChangeItems();
\t\t\tthis.listWidget.scrollToEnd();
\t\t}`;
  if (!transformed.includes(restoredScrollMarker)) {
    if (!transformed.includes(restoredAnchor)) {
      throw new Error(
        "Pinned Code - OSS restored chat scroll anchor not found",
      );
    }
    transformed = transformed.replace(
      restoredAnchor,
      `\t\tif (this.listWidget && this.visible) {
\t\t\tthis.onDidChangeItems();
\t\t\t${restoredScrollMarker}
\t\t\tif (getChatSessionType(this.viewModel?.sessionResource) === 'qivryn-agent') {
\t\t\t\tthis.listWidget.scrollTop = 0;
\t\t\t} else {
\t\t\t\tthis.listWidget.scrollToEnd();
\t\t\t}
\t\t}`,
    );
  }

  return transformed;
}
