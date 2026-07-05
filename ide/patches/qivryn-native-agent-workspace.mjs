export const containerTarget =
  "src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts";
export const openerTarget =
  "src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsOpener.ts";
export const viewPaneTarget =
  "src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts";
export const viewPaneCssTarget =
  "src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/media/chatViewPane.css";
export const sessionsFilterTarget =
  "src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsFilter.ts";
export const sessionsControlTarget =
  "src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsControl.ts";
export const editorInputTarget =
  "src/vs/workbench/contrib/chat/browser/widgetHosts/editor/chatEditorInput.ts";

const containerMarker = "// Qivryn native Agents sidebar";
const openerMarker =
  "// Qivryn sessions stay in the native Agent workspace pane";
const viewPaneMarker = "// Qivryn native Agents sidebar labels";
const visibilityMarker = "// Qivryn sidebar always presents agent sessions";
const groupingMarker =
  "// Qivryn sidebar uses the Codie-style recent hierarchy";
const legacyGroupingMarker = "// Qivryn sidebar groups durable agents by date";
const cssMarker = "/* Qivryn native Agents sidebar */";
const searchMarker = "// Qivryn native Agent search";
const filterMarker = "// Qivryn native Agent search filter";
const activeSelectionMarker = "// Qivryn keeps the active Agent row selected";
const editorMarker = "// Qivryn native agent editor title";

function replaceOnce(source, anchor, replacement, label) {
  const index = source.indexOf(anchor);
  if (index < 0)
    throw new Error(`Pinned Code - OSS anchor not found for ${label}`);
  if (source.indexOf(anchor, index + anchor.length) >= 0) {
    throw new Error(`Pinned Code - OSS anchor is ambiguous for ${label}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + anchor.length)}`;
}

export function applyQivrynAgentsContainer(source) {
  if (source.includes(containerMarker)) {
    return source
      .replace(
        `}, ViewContainerLocation.AuxiliaryBar, { isDefault: true, doNotRegisterOpenCommand: true }); ${containerMarker}`,
        `}, ViewContainerLocation.Panel, { isDefault: false, doNotRegisterOpenCommand: true }); ${containerMarker}`,
      )
      .replaceAll(
        `localize2('chat.viewContainer.label', "Agents")`,
        `localize2('chat.viewContainer.label', "Agent workspace")`,
      )
      .replace(
        `localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "&&Agents")`,
        `localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "Agent &&workspace")`,
      );
  }
  const registrationAnchor =
    "}, ViewContainerLocation.AuxiliaryBar, { isDefault: true, doNotRegisterOpenCommand: true });";
  let transformed = replaceOnce(
    source,
    registrationAnchor,
    `}, ViewContainerLocation.Panel, { isDefault: false, doNotRegisterOpenCommand: true }); ${containerMarker}`,
    "Agents auxiliary bar registration",
  );
  transformed = transformed.replaceAll(
    `localize2('chat.viewContainer.label', "Chat")`,
    `localize2('chat.viewContainer.label', "Agent workspace")`,
  );
  transformed = transformed.replace(
    `localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "&&Chat")`,
    `localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "Agent &&workspace")`,
  );
  return transformed;
}

export function applyQivrynSessionPaneOpener(source) {
  if (source.includes(openerMarker)) return source;
  const anchor = `		const isLocalChatSession = session.resource.scheme === Schemas.vscodeChatEditor || getChatSessionType(session.resource) === localChatSessionType;
		if (!isLocalChatSession && !(await chatSessionsService.canResolveChatSession(getChatSessionType(session.resource)))) {
			target = openOptions?.sideBySide ? SIDE_GROUP : ACTIVE_GROUP; // force to open in editor if session cannot be resolved in panel
			options = { ...options, revealIfOpened: true };
		}`;
  const replacement = `		const isLocalChatSession = session.resource.scheme === Schemas.vscodeChatEditor || getChatSessionType(session.resource) === localChatSessionType;
		const shouldFallbackToEditor =
			session.providerType !== 'qivryn-agent' &&
			!isLocalChatSession &&
			!(await chatSessionsService.canResolveChatSession(getChatSessionType(session.resource)));
		${openerMarker}
		if (shouldFallbackToEditor) {
			target = openOptions?.sideBySide ? SIDE_GROUP : ACTIVE_GROUP; // force to open in editor if session cannot be resolved in panel
			options = { ...options, revealIfOpened: true };
		}`;
  return replaceOnce(
    source,
    anchor,
    replacement,
    "Qivryn Agent workspace session opener",
  );
}

export const applyQivrynSessionEditorOpener = applyQivrynSessionPaneOpener;

export function applyQivrynAgentsViewPane(source) {
  const groupingAnchor = `groupResults: () => this.sessionsViewerOrientation === AgentSessionsViewerOrientation.Stacked ? AgentSessionsGrouping.Capped : AgentSessionsGrouping.Date`;
  const groupingReplacement = `${groupingMarker}\n\t\t\tgroupResults: () => this.getViewPositionAndLocation().location === ViewContainerLocation.Sidebar ? AgentSessionsGrouping.Capped : (this.sessionsViewerOrientation === AgentSessionsViewerOrientation.Stacked ? AgentSessionsGrouping.Capped : AgentSessionsGrouping.Date)`;
  if (source.includes(viewPaneMarker)) {
    let transformed = source.replace(
      "new Button(newSessionButtonContainer, { ...defaultButtonStyles, secondary: true })",
      "new Button(newSessionButtonContainer, { ...defaultButtonStyles, secondary: true, supportIcons: true })",
    );
    transformed = transformed.replace(
      "new Button(newSessionButtonContainer, { ...defaultButtonStyles, secondary: false })",
      "new Button(newSessionButtonContainer, { ...defaultButtonStyles, secondary: true, supportIcons: true })",
    );
    transformed = transformed.replace(
      `newSessionButton.label = localize('newSession', "New Agent");`,
      `newSessionButton.label = localize('newSession', "$(add) New Agent");`,
    );
    if (transformed.includes(groupingMarker)) return transformed;
    if (transformed.includes(legacyGroupingMarker)) {
      return replaceOnce(
        transformed,
        `${legacyGroupingMarker}\n\t\t\tgroupResults: () => this.getViewPositionAndLocation().location === ViewContainerLocation.Sidebar ? AgentSessionsGrouping.Date : (this.sessionsViewerOrientation === AgentSessionsViewerOrientation.Stacked ? AgentSessionsGrouping.Capped : AgentSessionsGrouping.Date)`,
        groupingReplacement,
        "legacy Qivryn sidebar grouping",
      );
    }
    return replaceOnce(
      transformed,
      groupingAnchor,
      groupingReplacement,
      "Qivryn sidebar grouping",
    );
  }
  let transformed = replaceOnce(
    source,
    `		sessionsTitle.textContent = localize('sessions', "Sessions");`,
    `		${viewPaneMarker}\n\t\tsessionsTitle.textContent = localize('sessions', "Agents");`,
    "Agents sidebar title",
  );
  transformed = replaceOnce(
    transformed,
    `		newSessionButton.label = localize('newSession', "New Session");`,
    `		newSessionButton.label = localize('newSession', "New Agent");`,
    "new Agent button",
  );
  transformed = transformed.replace(
    "new Button(newSessionButtonContainer, { ...defaultButtonStyles, secondary: true })",
    "new Button(newSessionButtonContainer, { ...defaultButtonStyles, secondary: true, supportIcons: true })",
  );
  transformed = transformed.replace(
    `newSessionButton.label = localize('newSession', "New Agent");`,
    `newSessionButton.label = localize('newSession', "$(add) New Agent");`,
  );
  const heightAnchor = `		if (this.sessionsViewerOrientation === AgentSessionsViewerOrientation.Stacked) {
			availableSessionsHeight -= Math.max(ChatViewPane.MIN_CHAT_WIDGET_HEIGHT, this._widget?.input?.height.get() ?? 0);
		} else {`;
  transformed = replaceOnce(
    transformed,
    heightAnchor,
    `		if (this.sessionsViewerOrientation === AgentSessionsViewerOrientation.Stacked && this.getViewPositionAndLocation().location !== ViewContainerLocation.Sidebar) {
			availableSessionsHeight -= Math.max(ChatViewPane.MIN_CHAT_WIDGET_HEIGHT, this._widget?.input?.height.get() ?? 0);
		} else if (this.sessionsViewerOrientation !== AgentSessionsViewerOrientation.Stacked) {`,
    "sidebar session height",
  );
  transformed = replaceOnce(
    transformed,
    groupingAnchor,
    groupingReplacement,
    "Qivryn sidebar grouping",
  );
  return transformed;
}

export function applyQivrynAgentsSearch(source) {
  if (source.includes(searchMarker)) return source;

  let transformed = replaceOnce(
    source,
    `\tprivate sessionsNewButtonContainer: HTMLElement | undefined;`,
    `\tprivate sessionsNewButtonContainer: HTMLElement | undefined;\n\tprivate sessionsSearchContainer: HTMLElement | undefined;`,
    "Agent search container state",
  );

  const filterAnchor = `\t\tthis._register(Event.runAndSubscribe(sessionsFilter.onDidChange, () => {
\t\t\tsessionsToolbarContainer.classList.toggle('filtered', !sessionsFilter.isDefault());
\t\t}));

\t\t// New Session Button`;
  transformed = replaceOnce(
    transformed,
    filterAnchor,
    `\t\tthis._register(Event.runAndSubscribe(sessionsFilter.onDidChange, () => {
\t\t\tsessionsToolbarContainer.classList.toggle('filtered', !sessionsFilter.isDefault());
\t\t}));

\t\t${searchMarker}
\t\tconst searchContainer = this.sessionsSearchContainer = append(sessionsContainer, $('.qivryn-agent-sidebar-search'));
\t\tconst searchInput = append(searchContainer, $('input.qivryn-agent-sidebar-search-input')) as HTMLInputElement;
\t\tsearchInput.type = 'search';
\t\tsearchInput.placeholder = localize('qivryn.searchAgents', "Search Agents…");
\t\tsearchInput.setAttribute('aria-label', localize('qivryn.searchAgents', "Search Agents…"));
\t\tsearchContainer.appendChild(sessionsToolbarContainer);
\t\tthis._register(addDisposableListener(searchInput, EventType.INPUT, () => sessionsFilter.setSearchQuery(searchInput.value)));
\t\tthis._register(addDisposableListener(searchInput, EventType.KEY_DOWN, event => {
\t\t\tif (event.key === 'Escape' && searchInput.value) {
\t\t\t\tsearchInput.value = '';
\t\t\t\tsessionsFilter.setSearchQuery('');
\t\t\t}
\t\t}));

\t\t// New Session Button`,
    "native Agent search input",
  );

  transformed = replaceOnce(
    transformed,
    `\t\tlet availableSessionsHeight = height - this.sessionsTitleContainer.offsetHeight;`,
    `\t\tlet availableSessionsHeight = height - this.sessionsTitleContainer.offsetHeight;
\t\tif (this.getViewPositionAndLocation().location === ViewContainerLocation.Sidebar) {
\t\t\tavailableSessionsHeight -= this.sessionsSearchContainer?.offsetHeight ?? 0;
\t\t\tavailableSessionsHeight -= this.sessionsNewButtonContainer?.offsetHeight ?? 0;
\t\t}`,
    "native Agent search layout",
  );

  transformed = replaceOnce(
    transformed,
    `\t\t\ttrackActiveEditorSession: () => {
\t\t\t\treturn !this._widget || this._widget.isEmpty(); // only track and reveal if chat widget is empty
\t\t\t},`,
    `\t\t\ttrackActiveEditorSession: () => {
\t\t\t\treturn this.getViewPositionAndLocation().location === ViewContainerLocation.Sidebar || !this._widget || this._widget.isEmpty();
\t\t\t},`,
    "active Agent tracking in the sidebar",
  );

  return transformed;
}

export function applyQivrynAgentsSearchFilter(source) {
  if (source.includes(filterMarker)) return source;

  let transformed = replaceOnce(
    source,
    `\tprivate currentSorting: AgentSessionsSorting = AgentSessionsSorting.Created;`,
    `\tprivate currentSorting: AgentSessionsSorting = AgentSessionsSorting.Created;\n\t${filterMarker}\n\tprivate searchQuery = '';`,
    "Agent search query state",
  );

  transformed = replaceOnce(
    transformed,
    `\tisDefault(): boolean {
\t\treturn equals(this.excludes, DEFAULT_EXCLUDES) && this.currentSorting === AgentSessionsSorting.Created;
\t}`,
    `\tsetSearchQuery(value: string): void {
\t\tconst query = value.trim().toLocaleLowerCase();
\t\tif (query === this.searchQuery) {
\t\t\treturn;
\t\t}
\t\tthis.searchQuery = query;
\t\tthis._onDidChange.fire();
\t}

\tisDefault(): boolean {
\t\treturn equals(this.excludes, DEFAULT_EXCLUDES) && this.currentSorting === AgentSessionsSorting.Created;
\t}`,
    "Agent search query setter",
  );

  transformed = replaceOnce(
    transformed,
    `\texclude(session: IAgentSession): boolean {
\t\tconst overrideExclude = this.options?.overrideExclude?.(session);`,
    `\texclude(session: IAgentSession): boolean {
\t\tif (this.searchQuery) {
\t\t\tconst description = typeof session.description === 'string' ? session.description : session.description?.value ?? '';
\t\t\tconst searchable = \`${"${session.label} ${description} ${session.providerLabel} ${session.resource.path}"}\`.toLocaleLowerCase();
\t\t\tif (!searchable.includes(this.searchQuery)) {
\t\t\t\treturn true;
\t\t\t}
\t\t}

\t\tconst overrideExclude = this.options?.overrideExclude?.(session);`,
    "Agent search query filtering",
  );

  return transformed;
}

export function applyQivrynActiveAgentSelection(source) {
  if (source.includes(activeSelectionMarker)) return source;
  return replaceOnce(
    source,
    `\t\tthis.registerListeners();`,
    `\t\tthis.registerListeners();\n\t\t${activeSelectionMarker}\n\t\tthis._register(this.onDidUpdate(() => this.revealAndFocusActiveEditorSession()));`,
    "active Agent sidebar selection",
  );
}

export function applyQivrynAgentsSidebarVisibility(source) {
  if (source.includes(visibilityMarker)) return source;
  const anchor = `\t\t} else {

\t\t\t// Sessions control: stacked`;
  const replacement = `\t\t} else if (this.getViewPositionAndLocation().location === ViewContainerLocation.Sidebar) {
\t\t\t${visibilityMarker}
\t\t\tnewSessionsContainerVisible = true;
\t\t} else {

\t\t\t// Sessions control: stacked`;
  return replaceOnce(
    source,
    anchor,
    replacement,
    "Agents sidebar session visibility",
  );
}

const qivrynAgentsSidebarCss = `${cssMarker}
.chat-viewpane.chat-view-location-sidebar {
	background: var(--vscode-sideBar-background);
	border-right: 1px solid color-mix(in srgb, var(--vscode-foreground) 5%, transparent);

	.chat-controls-container {
		display: none;
	}

	&.has-sessions-control .agent-sessions-container {
		flex: 1;
		max-width: none;
		margin: 0;
		width: 100%;
	}

	.agent-sessions-new-button-container {
		display: flex !important;
		flex-direction: column;
		gap: 1px;
		padding: 0 12px 10px;

		.monaco-button {
			border-radius: 6px;
			border: 0;
			background: transparent;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			height: 30px;
			justify-content: flex-start;
			padding: 6px 8px;
		}

		.monaco-button:hover {
			background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
			color: var(--vscode-foreground);
		}
	}

	.agent-sessions-title-container {
		display: none;
	}

	.agent-sessions-title {
		color: var(--vscode-sideBarTitle-foreground);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: .02em;
	}

	.agent-sessions-control-container {
		min-height: 0;
		overflow: hidden;
	}

	.qivryn-agent-sidebar-search {
		align-items: center;
		display: flex;
		gap: 4px;
		padding: 0 12px 4px;
	}

	.qivryn-agent-sidebar-search-input {
		background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
		border: 1px solid color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
		border-radius: 6px;
		box-sizing: border-box;
		color: var(--vscode-foreground);
		flex: 1;
		font-family: var(--vscode-font-family);
		font-size: 12px;
		height: 28px;
		line-height: 16px;
		min-width: 0;
		outline: none;
		padding: 6px 8px;
	}

	.qivryn-agent-sidebar-search-input::placeholder {
		color: var(--vscode-descriptionForeground);
		opacity: .72;
	}

	.qivryn-agent-sidebar-search-input:is(:hover, :focus) {
		border-color: color-mix(in srgb, var(--vscode-foreground) 16%, transparent);
	}

	.qivryn-agent-sidebar-search .agent-sessions-toolbar .action-item {
		margin: 0;
	}
}

/* Keep these critical shell rules flat. The packaged workbench preserves CSS
 * nesting, while some Electron cascade paths still resolve the upstream
 * declarations after nested rules. */
.monaco-workbench .chat-viewpane.chat-view-location-sidebar .agent-sessions-title-container {
	display: none !important;
}

.monaco-workbench .chat-viewpane.chat-view-location-sidebar .agent-sessions-new-button-container .monaco-button {
	background: transparent !important;
	border-color: transparent !important;
	color: var(--vscode-descriptionForeground) !important;
	justify-content: flex-start !important;
}

.monaco-workbench .chat-viewpane.chat-view-location-sidebar .agent-sessions-new-button-container .monaco-button:hover {
	background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent) !important;
	color: var(--vscode-foreground) !important;
}

.monaco-workbench .chat-viewpane.chat-view-location-sidebar .qivryn-agent-sidebar-search .agent-sessions-toolbar .action-label:not(.codicon-filter) {
	display: none !important;
}
`;

export function applyQivrynAgentsViewPaneCss(source) {
  const markerIndex = source.indexOf(cssMarker);
  if (markerIndex >= 0) {
    return `${source.slice(0, markerIndex).trimEnd()}\n\n${qivrynAgentsSidebarCss}\n`;
  }
  return `${source.trimEnd()}\n\n${qivrynAgentsSidebarCss}\n`;
}

export function applyQivrynAgentEditorTitle(source) {
  if (source.includes(editorMarker)) return source;
  const anchor = `		return this.options.title?.fallback ?? nls.localize('chatEditorName', "Chat");`;
  return replaceOnce(
    source,
    anchor,
    `		${editorMarker}\n\t\treturn this.options.title?.fallback ?? nls.localize('chatEditorName', "Qivryn Agent");`,
    "native Agent editor title",
  );
}
