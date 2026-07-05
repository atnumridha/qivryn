import assert from "node:assert/strict";
import test from "node:test";

import { applyNativeWorktreeTabs } from "../patches/native-worktree-tabs.mjs";
import { applyOptionalChatOnboarding } from "../patches/optional-chat-onboarding.mjs";
import { applyOptionalDefaultAccount } from "../patches/optional-default-account.mjs";
import { applyOptionalBuiltInCopilot } from "../patches/optional-built-in-copilot.mjs";
import { applyContextKeyCommand } from "../patches/context-key-command.mjs";
import {
  applyNativeAgentChatCss,
  applyNativeAgentInitialScroll,
  applyNativeAgentSessionsCss,
  applyNativeAgentSessionsViewer,
  applyNativeSessionHeaderRenderer,
  applyNativeSessionHeaderTransport,
} from "../patches/native-agent-sessions.mjs";
import { applyQivrynDefaultAgentSession } from "../patches/qivryn-default-agent-session.mjs";
import { applyNativeAgentSessionState } from "../patches/native-agent-session-state.mjs";
import { applyQivrynAgentWindowHandoff } from "../patches/qivryn-agent-window-handoff.mjs";
import {
  applyQivrynAgentsContainer,
  applyQivrynAgentEditorTitle,
  applyQivrynActiveAgentSelection,
  applyQivrynAgentsSearch,
  applyQivrynAgentsSearchFilter,
  applyQivrynAgentsSidebarVisibility,
  applyQivrynAgentsViewPane,
  applyQivrynAgentsViewPaneCss,
  applyQivrynSessionPaneOpener,
} from "../patches/qivryn-native-agent-workspace.mjs";
import { applyOptionalDefaultChatAgent } from "../patches/optional-default-chat-agent.mjs";
import {
  applyQivrynLayoutDimensions,
  applyQivrynSidebarMinimum,
} from "../patches/qivryn-sidebar-dimensions.mjs";
import { applyQivrynCliLauncher } from "../patches/qivryn-cli-launcher.mjs";
import { applyQivrynStartupEditor } from "../patches/qivryn-startup-editor.mjs";

const upstreamFixture = `
interface IEditorInputLabel {
\treadonly editor: EditorInput;

\treadonly name?: string;
\tdescription?: string;
\treadonly forceDescription?: boolean;
\treadonly title?: string;
\treadonly ariaLabel?: string;
}

\t\tthis.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).forEach((editor: EditorInput, tabIndex: number) => {
\t\t\tlabels.push({
\t\t\t\teditor,
\t\t\t\tname: editor.getName(),
\t\t\t\tdescription: editor.getDescription(verbosity),
\t\t\t\tforceDescription: editor.hasCapability(EditorInputCapabilities.ForceDescription),
\t\t\t\ttitle: editor.getTitle(Verbosity.LONG),
\t\t\t\tariaLabel: computeEditorAriaLabel(editor, tabIndex, this.groupView, this.editorPartsView.count)
\t\t\t});
`;

test("packages cleanly without the stock built-in Copilot extension", () => {
  const upstream = `
\t\tconst builtInCopilotExtensionDir = path.join(appBase, 'extensions', 'copilot');
\t\tprepareBuiltInCopilotRipgrepShim(platform, arch, builtInCopilotExtensionDir, appNodeModulesDir);
`;
  const patched = applyOptionalBuiltInCopilot(upstream);
  assert.match(patched, /fs\.existsSync\(builtInCopilotExtensionDir\)/);
  assert.equal(applyOptionalBuiltInCopilot(patched), patched);
});

test("packages the macOS product launcher as qivryn", () => {
  const upstream = `.pipe(rename('bin/code'));`;
  const patched = applyQivrynCliLauncher(upstream);
  assert.match(patched, /product\.applicationName/);
  assert.equal(applyQivrynCliLauncher(patched), patched);
});

test("starts in the durable Agent workspace instead of Welcome", () => {
  const upstream = "\t\t\t'default': 'welcomePage',";
  const patched = applyQivrynStartupEditor(upstream);
  assert.match(patched, /Qivryn opens the durable Agent workspace/);
  assert.match(patched, /'default': 'none'/);
  assert.equal(applyQivrynStartupEditor(patched), patched);
});

test("adds native repository, branch, worktree, and run identity to tabs", () => {
  const patched = applyNativeWorktreeTabs(upstreamFixture);
  assert.match(patched, /interface IQivrynAgentWorktree/);
  assert.match(patched, /qivryn\.agentWorktrees/);
  assert.match(patched, /qivrynAgentWorktree\.repository/);
  assert.match(patched, /qivrynAgentWorktree\.branch/);
  assert.match(patched, /qivrynAgentWorktree\.title/);
  assert.match(patched, /forceDescription: Boolean\(qivrynAgentLabel\)/);
  assert.equal(applyNativeWorktreeTabs(patched), patched);
});

test("fails safely when the pinned upstream source changes", () => {
  assert.throws(
    () => applyNativeWorktreeTabs("interface ChangedUpstream {}"),
    /anchor not found/,
  );
});

const onboardingFixture = `
import { assertDefined } from '../../../../base/common/types.js';

assertDefined(product.defaultChatAgent, 'Onboarding requires a default chat agent product configuration.');
const defaultChat = product.defaultChatAgent;

\tshow(): void {
\t\tif (this.overlay) {
`;

test("makes upstream chat onboarding optional for Qivryn", () => {
  const patched = applyOptionalChatOnboarding(onboardingFixture);
  assert.doesNotMatch(patched, /assertDefined/);
  assert.match(patched, /if \(!product\.defaultChatAgent\)/);
  assert.match(patched, /this\._onDidDismiss\.fire\(\)/);
  assert.equal(applyOptionalChatOnboarding(patched), patched);
});

test("fails safely when the onboarding source changes", () => {
  assert.throws(
    () => applyOptionalChatOnboarding("class ChangedOnboarding {}"),
    /anchor not found/,
  );
});

const defaultAccountFixture = `
function toDefaultAccountConfig(defaultChatAgent: IDefaultChatAgent): IDefaultAccountConfig {
\treturn {

\t\tsuper();
\t\tthis.defaultAccountConfig = toDefaultAccountConfig(productService.defaultChatAgent);
\t}

\t) {
\t\tsuper();
\t\tconst defaultAccountProvider = this._register(instantiationService.createInstance(DefaultAccountProvider, toDefaultAccountConfig(productService.defaultChatAgent)));
`;

test("makes the upstream default account service product-neutral", () => {
  const patched = applyOptionalDefaultAccount(defaultAccountFixture);
  assert.match(patched, /IDefaultChatAgent \| undefined/);
  assert.match(patched, /this\.initBarrier\.open\(\)/);
  assert.match(patched, /if \(!productService\.defaultChatAgent\)/);
  assert.equal(applyOptionalDefaultAccount(patched), patched);
});

test("fails safely when the default account source changes", () => {
  assert.throws(
    () => applyOptionalDefaultAccount("class ChangedDefaultAccount {}"),
    /anchor not found/,
  );
});

test("adds the native read-only context bridge used by saved layouts", () => {
  const upstream = `
export const ToggleActivityBarVisibilityActionId = 'workbench.action.toggleActivityBarVisibility';
`;
  const patched = applyContextKeyCommand(upstream);
  assert.match(patched, /id: 'getContextKeyValue'/);
  assert.match(patched, /getContextKeyValue\(key\)/);
  assert.equal(applyContextKeyCommand(patched), patched);
});

test("fails safely when the layout actions source changes", () => {
  assert.throws(
    () => applyContextKeyCommand("class ChangedLayoutActions {}"),
    /anchor not found/,
  );
});

test("applies the native Qivryn Agent Sessions visual system idempotently", () => {
  const upstreamCss = `.agent-sessions-viewer {\n\tflex: 1;\n}\n`;
  const patched = applyNativeAgentSessionsCss(upstreamCss);
  assert.match(patched, /Qivryn native agent sessions/);
  assert.match(patched, /--qivryn-agent-sidebar-width: 256px/);
  assert.match(patched, /gap: 12px/);
  assert.match(patched, /padding: 6px var\(--qivryn-agent-row-padding-x\)/);
  assert.match(patched, /agent-session-title-row[\s\S]*height: 16px/);
  assert.match(patched, /agent-session-details-row[\s\S]*height: 14px/);
  assert.match(patched, /agent-session-approval-row/);
  assert.equal(applyNativeAgentSessionsCss(patched), patched);
});

test("adds the persistent Codie-style Agent search and filtering path", () => {
  const viewPane = `
\tprivate sessionsNewButtonContainer: HTMLElement | undefined;
\t\tthis._register(Event.runAndSubscribe(sessionsFilter.onDidChange, () => {
\t\t\tsessionsToolbarContainer.classList.toggle('filtered', !sessionsFilter.isDefault());
\t\t}));

\t\t// New Session Button
\t\tlet availableSessionsHeight = height - this.sessionsTitleContainer.offsetHeight;
\t\t\ttrackActiveEditorSession: () => {
\t\t\t\treturn !this._widget || this._widget.isEmpty(); // only track and reveal if chat widget is empty
\t\t\t},
`;
  const patchedViewPane = applyQivrynAgentsSearch(viewPane);
  assert.match(patchedViewPane, /Search Agents…/);
  assert.match(patchedViewPane, /sessionsFilter\.setSearchQuery/);
  assert.match(patchedViewPane, /sessionsSearchContainer\?\.offsetHeight/);
  assert.match(patchedViewPane, /ViewContainerLocation\.Sidebar/);
  assert.equal(applyQivrynAgentsSearch(patchedViewPane), patchedViewPane);

  const filter = `
\tprivate currentSorting: AgentSessionsSorting = AgentSessionsSorting.Created;
\tisDefault(): boolean {
\t\treturn equals(this.excludes, DEFAULT_EXCLUDES) && this.currentSorting === AgentSessionsSorting.Created;
\t}
\texclude(session: IAgentSession): boolean {
\t\tconst overrideExclude = this.options?.overrideExclude?.(session);
`;
  const patchedFilter = applyQivrynAgentsSearchFilter(filter);
  assert.match(patchedFilter, /private searchQuery = ''/);
  assert.match(patchedFilter, /setSearchQuery\(value: string\)/);
  assert.match(patchedFilter, /searchable\.includes\(this\.searchQuery\)/);
  assert.equal(applyQivrynAgentsSearchFilter(patchedFilter), patchedFilter);
});

test("uses the concise native Agents accessibility label", () => {
  const upstream = `
return localize('agentSessions', "Agent Sessions");
\tstatic readonly ITEM_HEIGHT = 54;
\tstatic readonly SECTION_HEIGHT = 26;
\tprivate static readonly CAPPED_SESSIONS_LIMIT = 3;
\t\tresult.push(...pinnedSessions, ...topUnpinned);
`;
  const patched = applyNativeAgentSessionsViewer(upstream);
  assert.match(patched, /localize\('agentSessions', "Agents"\)/);
  assert.match(patched, /ITEM_HEIGHT = 44/);
  assert.match(patched, /SECTION_HEIGHT = 24/);
  assert.match(patched, /CAPPED_SESSIONS_LIMIT = 12/);
  assert.match(patched, /"Recent"/);
  assert.equal(applyNativeAgentSessionsViewer(patched), patched);
});

test("migrates an already prepared agent viewer to the Recent hierarchy", () => {
  const previouslyPrepared = `
return localize('agentSessions', "Agents");
	// Qivryn Codie-density agent rows
	static readonly ITEM_HEIGHT = 44;
	static readonly SECTION_HEIGHT = 24;
	private static readonly CAPPED_SESSIONS_LIMIT = 3;
		result.push(...pinnedSessions, ...topUnpinned);
`;
  const migrated = applyNativeAgentSessionsViewer(previouslyPrepared);
  assert.match(migrated, /CAPPED_SESSIONS_LIMIT = 12/);
  assert.match(migrated, /qivryn\.agentSessions\.recentSection/);
  assert.equal(applyNativeAgentSessionsViewer(migrated), migrated);
});

test("applies the native Codie-density transcript and composer style", () => {
  const patched = applyNativeAgentChatCss(".interactive-session {}\n");
  assert.match(patched, /Qivryn Codie-density native transcript/);
  assert.match(patched, /--qivryn-transcript-width: 760px/);
  assert.match(patched, /--qivryn-composer-width: 780px/);
  assert.match(patched, /chat-tool-invocation-part/);
  assert.match(
    patched,
    /interactive-item-container \.header[\s\S]*display: none !important/,
  );
  assert.equal(applyNativeAgentChatCss(patched), patched);
});

test("transports the native Qivryn identity before the visible prompt", () => {
  const transport = applyNativeSessionHeaderTransport(`
\t\t\tmodelId: turn.modelId,
\t\t\tmodeInstructions: typeConvert.ChatRequestModeInstructions.from(turn.modeInstructions2),
`);
  assert.match(transport, /isSystemInitiated/);
  assert.match(transport, /systemInitiatedLabel/);
  assert.equal(applyNativeSessionHeaderTransport(transport), transport);

  const renderer = applyNativeSessionHeaderRenderer(`
\t\tconst isSystemInitiatedRequest = isRequestVM(element) && !!element.isSystemInitiated;
\t\ttemplateData.rowContainer.classList.toggle('system-initiated-request', !!element.isSystemInitiated);

\t\t// System-initiated requests render as compact progress-style messages
\t\tif (element.isSystemInitiated) {
`);
  assert.match(renderer, /qivryn\.session\.header/);
  assert.match(renderer, /qivryn-session-preamble-request/);
  assert.match(renderer, /index === 0/);
  assert.match(renderer, /!element\.messageText\.trim\(\)/);
  assert.match(renderer, /qivryn-session-header-request/);
  assert.match(renderer, /!isQivrynSessionHeader/);
  assert.match(renderer, /dom\.clearNode\(templateData\.value\)/);
  assert.equal(applyNativeSessionHeaderRenderer(renderer), renderer);

  const scroll = applyNativeAgentInitialScroll(`
\t\tif (this.viewModel) {
\t\t\tthis.onDidChangeItems();
\t\t\tthis.listWidget.scrollToEnd();
\t\t}
\t\tif (this.listWidget && this.visible) {
\t\t\tthis.onDidChangeItems();
\t\t\tthis.listWidget.scrollToEnd();
\t\t}
`);
  assert.match(
    scroll,
    /getChatSessionType\(this\.viewModel\.sessionResource\)/,
  );
  assert.match(
    scroll,
    /getChatSessionType\(this\.viewModel\?\.sessionResource\)/,
  );
  assert.match(scroll, /this\.listWidget\.scrollTop = 0/);
  assert.equal(applyNativeAgentInitialScroll(scroll), scroll);
});

test("migrates the prepared transcript to the headerless Codie layout", () => {
  const prepared = `${applyNativeAgentChatCss(".interactive-session {}\n")}`
    .replace("display: none !important;", "margin-bottom: 4px;")
    .replace(
      "--qivryn-composer-width: 780px;",
      "--qivryn-composer-width: 700px;",
    );
  const migrated = applyNativeAgentChatCss(prepared);
  assert.match(migrated, /display: none !important/);
  assert.match(migrated, /--qivryn-composer-width: 780px/);
  assert.doesNotMatch(migrated, /margin-bottom: 4px/);
  assert.equal(applyNativeAgentChatCss(migrated), migrated);
});

test("fails safely when the pinned Agent Sessions viewer changes", () => {
  assert.throws(
    () => applyNativeAgentSessionsViewer("class ChangedAgentSessions {}"),
    /accessibility label/,
  );
});

test("selects Qivryn as the native default chat session provider", () => {
  const upstream = `
export function getDefaultNewChatSessionType(
\tconfigurationService: IConfigurationService,
\tchatSessionsService: Pick<IChatSessionsService, 'getChatSessionContribution' | 'getAllChatSessionContributions'>
): string {
\tconst defaultProvider = configurationService.getValue<string>(ChatConfiguration.EditorDefaultProvider);
`;
  const patched = applyQivrynDefaultAgentSession(upstream);
  assert.match(patched, /qivryn-agent/);
  assert.match(patched, /getChatSessionContribution/);
  assert.equal(applyQivrynDefaultAgentSession(patched), patched);
});

test("fails safely when default session selection changes upstream", () => {
  assert.throws(
    () => applyQivrynDefaultAgentSession("function changedDefault() {}"),
    /selection anchor/,
  );
});

test("hydrates and synchronizes native pin and read state", () => {
  const upstream = `
import { IChatWidgetService } from '../chat.js';

\t\t@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
\t) {
\tprivate isPinned(session: IInternalAgentSessionData): boolean {
\t\treturn this.resolveStateEntry(session)?.pinned ?? false;
\t}
\t\tthis.sessionStates.set(session.resource, { ...state, pinned });

\t\tthis._onDidChangeSessions.fire();
\tprivate isMarkedUnread(session: IInternalAgentSessionData): boolean {
\t\treturn this.resolveStateEntry(session)?.read === AgentSessionsModel.UNREAD_MARKER;
\t}
\t\tif (this.isArchived(session)) {
\t\t\treturn true; // archived sessions are always read
\t\t}

\t\tconst storedReadDate = this.resolveStateEntry(session)?.read;
\t\tthis.sessionStates.set(session.resource, { ...state, read: newRead });

\t\tif (!skipEvent) {
\tprivate static readonly READ_DATE_BASELINE_KEY
`;
  const patched = applyNativeAgentSessionState(upstream);
  assert.match(patched, /qivryn\.syncNativeAgentState/);
  assert.match(patched, /session\.metadata\?\.pinned/);
  assert.match(patched, /session\.metadata\?\.unread/);
  assert.equal(applyNativeAgentSessionState(patched), patched);
});

test("fails safely when native state internals change upstream", () => {
  assert.throws(
    () => applyNativeAgentSessionState("class ChangedState {}"),
    /state anchor/,
  );
});

test("allows Qivryn sessions to hand off to the native Agents Window", () => {
  const upstream = `
\t\t\t\t\tContextKeyExpr.or(
\t\t\t\t\t\tChatContextKeys.chatSessionType.isEqualTo(SessionType.CopilotCLI),
\t\t\t\t\t\tChatContextKeys.chatSessionType.isEqualTo(SessionType.AgentHostCopilot),
\t\t\t\t\t),
`;
  const patched = applyQivrynAgentWindowHandoff(upstream);
  assert.match(patched, /chatSessionType\.isEqualTo\('qivryn-agent'\)/);
  assert.equal(applyQivrynAgentWindowHandoff(patched), patched);
});

test("fails safely when native handoff internals change upstream", () => {
  assert.throws(
    () => applyQivrynAgentWindowHandoff("class ChangedHandoff {}"),
    /handoff provider anchor/,
  );
});

test("keeps the stock Agent workspace out of the right sidebar", () => {
  const upstream = `
title: localize2('chat.viewContainer.label', "Chat"),
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true, doNotRegisterOpenCommand: true });
containerTitle: localize2('chat.viewContainer.label', "Chat"),
name: localize2('chat.viewContainer.label', "Chat"),
mnemonicTitle: localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "&&Chat"),
`;
  const patched = applyQivrynAgentsContainer(upstream);
  assert.match(patched, /ViewContainerLocation\.Panel/);
  assert.doesNotMatch(patched, /isDefault: true/);
  assert.doesNotMatch(patched, /"Chat"/);
  assert.equal(applyQivrynAgentsContainer(patched), patched);
});

test("keeps Qivryn sessions in the native Agent workspace pane", () => {
  const upstream = `
		let target: typeof SIDE_GROUP | typeof ACTIVE_GROUP | typeof ChatViewPaneTarget | undefined;
		if (openOptions?.sideBySide) {
			target = ACTIVE_GROUP;
		} else {
			target = ChatViewPaneTarget;
		}

		const isLocalChatSession = session.resource.scheme === Schemas.vscodeChatEditor || getChatSessionType(session.resource) === localChatSessionType;
		if (!isLocalChatSession && !(await chatSessionsService.canResolveChatSession(getChatSessionType(session.resource)))) {
			target = openOptions?.sideBySide ? SIDE_GROUP : ACTIVE_GROUP; // force to open in editor if session cannot be resolved in panel
			options = { ...options, revealIfOpened: true };
		}
`;
  const patched = applyQivrynSessionPaneOpener(upstream);
  assert.match(patched, /shouldFallbackToEditor/);
  assert.match(patched, /session\.providerType !== 'qivryn-agent'/);
  assert.match(patched, /ChatViewPaneTarget/);
  assert.equal(applyQivrynSessionPaneOpener(patched), patched);
});

test("turns the sidebar Chat pane into a session-only Agents pane", () => {
  const upstream = `
		sessionsTitle.textContent = localize('sessions', "Sessions");
		const newSessionButton = this._register(new Button(newSessionButtonContainer, { ...defaultButtonStyles, secondary: true }));
		newSessionButton.label = localize('newSession', "New Session");
		if (this.sessionsViewerOrientation === AgentSessionsViewerOrientation.Stacked) {
			availableSessionsHeight -= Math.max(ChatViewPane.MIN_CHAT_WIDGET_HEIGHT, this._widget?.input?.height.get() ?? 0);
		} else {
		const sessionsFilter = this._register(this.instantiationService.createInstance(AgentSessionsFilter, {
			groupResults: () => this.sessionsViewerOrientation === AgentSessionsViewerOrientation.Stacked ? AgentSessionsGrouping.Capped : AgentSessionsGrouping.Date
  		}));
`;
  const patched = applyQivrynAgentsViewPane(upstream);
  assert.match(patched, /"Agents"/);
  assert.match(patched, /\$\(add\) New Agent/);
  assert.match(patched, /location !== ViewContainerLocation\.Sidebar/);
  assert.match(patched, /Qivryn sidebar uses the Codie-style recent hierarchy/);
  assert.match(patched, /supportIcons: true/);
  assert.equal(applyQivrynAgentsViewPane(patched), patched);

  const css = applyQivrynAgentsViewPaneCss(".chat-viewpane {}\n");
  assert.match(css, /chat-controls-container[\s\S]*display: none/);
  assert.match(css, /agent-sessions-container/);
  assert.match(
    css,
    /agent-sessions-title-container[\s\S]*display: none !important/,
  );
  assert.match(css, /action-label:not\(\.codicon-filter\)/);
  assert.equal(applyQivrynAgentsViewPaneCss(css), css);
});

test("keeps the restored native Agent selected in the sidebar", () => {
  const upstream = `
\t\tthis.registerListeners();
`;
  const patched = applyQivrynActiveAgentSelection(upstream);
  assert.match(patched, /onDidUpdate/);
  assert.match(patched, /revealAndFocusActiveEditorSession/);
  assert.equal(applyQivrynActiveAgentSelection(patched), patched);
});

test("keeps native agent sessions visible without stock Chat entitlement", () => {
  const upstream = `
\t\t} else {

\t\t\t// Sessions control: stacked
`;
  const patched = applyQivrynAgentsSidebarVisibility(upstream);
  assert.match(patched, /ViewContainerLocation\.Sidebar/);
  assert.match(patched, /newSessionsContainerVisible = true/);
  assert.equal(applyQivrynAgentsSidebarVisibility(patched), patched);
});

test("permits products with Chat Sessions but no default local chat agent", () => {
  const upstream = `
		if (!defaultAgentData) {
			throw new ErrorNoTelemetry('No default agent contributed');
		}
`;
  const patched = applyOptionalDefaultChatAgent(upstream);
  assert.match(patched, /return;/);
  assert.doesNotMatch(patched, /No default agent contributed/);
  assert.equal(applyOptionalDefaultChatAgent(patched), patched);
});

test("uses the frozen Codie-density 256 pixel Agents sidebar", () => {
  const layout = applyQivrynLayoutDimensions(`
SIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),
Math.min(300, mainContainerDimension.width / 4)
Math.min(300, configuration.mainContainerDimension.width / 4)
`);
  assert.match(layout, /sideBar\.size'[\s\S]*256/);
  assert.doesNotMatch(layout, /Math\.min\(300/);
  assert.equal(applyQivrynLayoutDimensions(layout), layout);

  const sidebar = applyQivrynSidebarMinimum(`
		return Math.max(width, 300);
`);
  assert.match(sidebar, /Math\.max\(width, 256\)/);
  assert.equal(applyQivrynSidebarMinimum(sidebar), sidebar);
});

test("uses a Qivryn Agent title for an untitled native editor", () => {
  const upstream = `
		return this.options.title?.fallback ?? nls.localize('chatEditorName', "Chat");
`;
  const patched = applyQivrynAgentEditorTitle(upstream);
  assert.match(patched, /"Qivryn Agent"/);
  assert.equal(applyQivrynAgentEditorTitle(patched), patched);
});
