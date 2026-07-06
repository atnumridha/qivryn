import {
  filterAgentRuns,
  projectAgentTranscript,
  toQivrynAgentSessionMetadata,
  type AgentControlRequest,
  type AgentEvent,
  type AgentRun,
  type QivrynTranscriptItem,
} from "@qivryn/agent-runtime";
import type { FromCoreProtocol, ToCoreProtocol } from "core/protocol";
import type { InProcessMessenger } from "core/protocol/messenger";
import * as vscode from "vscode";

const SESSION_SCHEME = "qivryn-agent";
const PARTICIPANT_ID = "qivryn.agent";
const TERMINAL_STATUSES = new Set<AgentRun["status"]>([
  "completed",
  "failed",
  "canceled",
  "archived",
]);

interface NativeChatSessionItem {
  resource: vscode.Uri;
  label: string;
  description?: string | vscode.MarkdownString;
  badge?: string | vscode.MarkdownString;
  status?: number;
  tooltip?: string | vscode.MarkdownString;
  archived?: boolean;
  timing?: {
    created: number;
    lastRequestStarted?: number;
    lastRequestEnded?: number;
  };
  metadata?: Record<string, unknown>;
  iconPath?: vscode.ThemeIcon;
  changes?: readonly {
    uri: vscode.Uri;
    originalUri?: vscode.Uri;
    modifiedUri?: vscode.Uri;
    insertions: number;
    deletions: number;
  }[];
}

interface NativeChatSessionItemController extends vscode.Disposable {
  readonly items: {
    replace(items: readonly NativeChatSessionItem[]): void;
    add(item: NativeChatSessionItem): void;
    get(resource: vscode.Uri): NativeChatSessionItem | undefined;
  };
  newChatSessionItemHandler?: (
    context: {
      request: { prompt: string; command?: string };
      inputState: NativeChatSessionInputState;
    },
    token: vscode.CancellationToken,
  ) => Promise<NativeChatSessionItem>;
  forkHandler?: (
    resource: vscode.Uri,
    request: { prompt: string } | undefined,
    token: vscode.CancellationToken,
  ) => Promise<NativeChatSessionItem>;
  getChatSessionInputState?: (
    resource: vscode.Uri | undefined,
    context: { previousInputState?: NativeChatSessionInputState },
    token: vscode.CancellationToken,
  ) => Promise<NativeChatSessionInputState>;
  resolveChatSessionItem?: (
    item: NativeChatSessionItem,
    token: vscode.CancellationToken,
  ) => Promise<void>;
  onDidChangeChatSessionItemState?: vscode.Event<NativeChatSessionItem>;
  createChatSessionItem(
    resource: vscode.Uri,
    label: string,
  ): NativeChatSessionItem;
  createChatSessionInputState(
    groups: NativeChatSessionOptionGroup[],
  ): NativeChatSessionInputState;
}

interface NativeChatSessionOptionItem {
  id: string;
  name: string;
  description?: string;
  icon?: vscode.ThemeIcon;
  locked?: boolean;
}

interface NativeChatSessionOptionGroup {
  id: string;
  name: string;
  description?: string;
  items: NativeChatSessionOptionItem[];
  selected?: NativeChatSessionOptionItem;
}

interface NativeChatSessionInputState {
  groups: NativeChatSessionOptionGroup[];
  onDidDispose?(listener: () => void): vscode.Disposable;
}

interface NativeResponseStream {
  markdown(value: string | vscode.MarkdownString): void;
  progress(value: string): void;
  button?(command: vscode.Command): void;
  confirmation?(
    title: string,
    message: string | vscode.MarkdownString,
    data: unknown,
    buttons?: string[],
  ): void;
  push?(part: unknown): void;
}

interface NativeChatRequest {
  prompt: string;
  acceptedConfirmationData?: unknown[];
  rejectedConfirmationData?: unknown[];
}

interface NativeChatNamespace {
  createChatParticipant(
    id: string,
    handler: (
      request: NativeChatRequest,
      context: unknown,
      stream: NativeResponseStream,
      token: vscode.CancellationToken,
    ) => Promise<Record<string, unknown> | void>,
  ): vscode.Disposable & { iconPath?: vscode.Uri };
  createChatSessionItemController(
    type: string,
    refresh: (token: vscode.CancellationToken) => Promise<void>,
  ): NativeChatSessionItemController;
  registerChatSessionContentProvider(
    scheme: string,
    provider: {
      provideChatSessionContent(
        resource: vscode.Uri,
        token: vscode.CancellationToken,
        context: { inputState: NativeChatSessionInputState },
      ): Promise<Record<string, unknown>>;
    },
    participant: vscode.Disposable,
    capabilities?: { supportsInterruptions?: boolean },
  ): vscode.Disposable;
}

type CoreMessenger = InProcessMessenger<ToCoreProtocol, FromCoreProtocol>;

export class NativeAgentSessionsProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly itemsByRunId = new Map<string, NativeChatSessionItem>();
  private controller?: NativeChatSessionItemController;
  private refreshTimer?: NodeJS.Timeout;
  private disposed = false;
  private isAgentsWindow = false;
  private initialSessionRestored = false;
  private currentRunId?: string;

  static registerIfSupported(
    context: vscode.ExtensionContext,
    messenger: CoreMessenger,
  ): NativeAgentSessionsProvider | undefined {
    const chat = (vscode as unknown as { chat?: NativeChatNamespace }).chat;
    if (
      !chat?.createChatParticipant ||
      !chat.createChatSessionItemController ||
      !chat.registerChatSessionContentProvider
    ) {
      void vscode.commands.executeCommand(
        "setContext",
        "qivryn.nativeAgentSessions",
        false,
      );
      return undefined;
    }
    try {
      const provider = new NativeAgentSessionsProvider(
        context,
        messenger,
        chat,
      );
      context.subscriptions.push(provider);
      return provider;
    } catch (error) {
      console.warn(
        "[Qivryn] Native Agent Sessions are unavailable; using the React fallback",
        error,
      );
      void vscode.commands.executeCommand(
        "setContext",
        "qivryn.nativeAgentSessions",
        false,
      );
      return undefined;
    }
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly messenger: CoreMessenger,
    private readonly chat: NativeChatNamespace,
  ) {
    const participant = chat.createChatParticipant(
      PARTICIPANT_ID,
      async (request, context, stream, token) => {
        if (await this.resolveApprovalsFromRequest(request)) return {};
        const runId = this.runIdFromChatContext(context) ?? this.activeRunId();
        if (!runId) {
          stream.markdown(
            "Select or create a Qivryn agent before sending a message.",
          );
          return {};
        }
        await this.submitFollowUp(runId, request.prompt, stream, token);
        return {};
      },
    );
    participant.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      "media",
      "sidebar-icon.png",
    );
    this.disposables.push(participant);

    this.controller = chat.createChatSessionItemController(
      SESSION_SCHEME,
      async () => this.refresh(),
    );
    this.disposables.push(this.controller);
    this.configureController(this.controller);

    this.disposables.push(
      chat.registerChatSessionContentProvider(
        SESSION_SCHEME,
        {
          provideChatSessionContent: (resource, token, providerContext) =>
            this.provideSession(resource, token, providerContext.inputState),
        },
        participant,
        { supportsInterruptions: true },
      ),
      vscode.commands.registerCommand(
        "qivryn.resolveAgentApproval",
        async (runId: string, approvalId: string, decision: string) => {
          await this.control({
            action: "approval.resolve",
            runId,
            approvalId,
            decision: decision as "approve" | "approveAlways" | "reject",
          });
          await this.refresh();
        },
      ),
      vscode.commands.registerCommand(
        "qivryn.openNativeAgent",
        async (input: string | vscode.Uri | { resource?: vscode.Uri }) => {
          const resource = this.resourceFromCommandInput(input);
          const runId = this.runIdFromResource(resource);
          this.currentRunId = runId;
          await vscode.commands.executeCommand(
            "setContext",
            "qivryn.activeAgentSession",
            runId,
          );
          await this.context.workspaceState.update(
            "qivryn.nativeAgent.lastRunId",
            runId,
          );
          await vscode.commands.executeCommand("vscode.open", resource);
        },
      ),
      vscode.commands.registerCommand("qivryn.restoreNativeAgentSurface", () =>
        this.restoreDefaultSurface(),
      ),
      vscode.commands.registerCommand("qivryn.closeRestoredAgentEditors", () =>
        this.closeStartupPlaceholders(),
      ),
      vscode.commands.registerCommand(
        "qivryn.toggleActiveAgentPin",
        async () => {
          const run = await this.currentRun();
          if (!run) return;
          await this.control({
            action: "pin",
            runId: run.id,
            pinned: !run.pinned,
          });
          await this.refresh();
        },
      ),
      vscode.commands.registerCommand(
        "qivryn.duplicateActiveAgent",
        async () => {
          const run = await this.currentRun();
          if (!run) return;
          const duplicate = (await this.control({
            action: "run.duplicate",
            runId: run.id,
          })) as AgentRun;
          await this.refresh();
          await vscode.commands.executeCommand(
            "qivryn.openNativeAgent",
            this.resourceForRun(duplicate.id),
          );
        },
      ),
      vscode.commands.registerCommand("qivryn.archiveActiveAgent", async () => {
        const run = await this.currentRun();
        if (!run) return;
        await this.control({
          action: run.status === "archived" ? "unarchive" : "archive",
          runId: run.id,
        });
        await this.refresh();
      }),
      vscode.commands.registerCommand("qivryn.cancelActiveAgent", async () => {
        const run = await this.currentRun();
        if (!run || TERMINAL_STATUSES.has(run.status)) return;
        await this.control({ action: "run.cancel", runId: run.id });
        await this.refresh();
      }),
      vscode.commands.registerCommand("qivryn.resumeActiveAgent", async () => {
        const run = await this.currentRun();
        if (!run || run.status === "archived") return;
        await this.control({ action: "run.resume", runId: run.id });
        await this.refresh();
      }),
      vscode.commands.registerCommand(
        "qivryn.syncNativeAgentState",
        async (state: {
          runId: string;
          pinned?: boolean;
          unread?: boolean;
        }) => {
          if (typeof state.pinned === "boolean") {
            await this.control({
              action: "pin",
              runId: state.runId,
              pinned: state.pinned,
            });
          }
          if (typeof state.unread === "boolean") {
            await this.control({
              action: "unread",
              runId: state.runId,
              unread: state.unread,
            });
          }
          await this.refresh();
        },
      ),
      vscode.commands.registerCommand(
        "qivryn.openNativeAgentInAgentsWindow",
        async (input?: string | vscode.Uri | { resource?: vscode.Uri }) => {
          const sessionResource = input
            ? this.resourceFromCommandInput(input)
            : this.currentRunId
              ? this.resourceForRun(this.currentRunId)
              : undefined;
          if (!sessionResource) return;
          const runId = this.runIdFromResource(sessionResource);
          this.currentRunId = runId;
          await Promise.all([
            this.context.workspaceState.update(
              "qivryn.nativeAgent.lastRunId",
              runId,
            ),
            this.context.globalState.update(
              "qivryn.nativeAgent.handoffRunId",
              runId,
            ),
            vscode.commands.executeCommand(
              "setContext",
              "qivryn.activeAgentSession",
              runId,
            ),
          ]);
          await vscode.commands.executeCommand(
            "qivryn.openAgentsWindow",
            sessionResource,
          );
        },
      ),
    );

    void vscode.commands.executeCommand(
      "setContext",
      "qivryn.nativeAgentSessions",
      true,
    );
    void this.refreshWindowContext().then(() => this.restoreHandoffSession());
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), 2_000);
    this.refreshTimer.unref?.();
  }

  async restoreDefaultSurface(): Promise<boolean> {
    await this.closeStartupPlaceholders();
    try {
      this.initialSessionRestored = true;
      await vscode.commands.executeCommand(
        "qivryn.openInNewWindow",
        "/",
        false,
        false,
      );
      await vscode.commands.executeCommand(
        "workbench.action.closeAuxiliaryBar",
      );
      await this.closeStartupPlaceholders();
      return true;
    } catch (error) {
      console.warn("[Qivryn] Failed to restore native agent surface", error);
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
    void vscode.commands.executeCommand(
      "setContext",
      "qivryn.nativeAgentSessions",
      false,
    );
  }

  private configureController(controller: NativeChatSessionItemController) {
    controller.newChatSessionItemHandler = async (context) => {
      const prompt = context.request.prompt.trim();
      if (!prompt) throw new Error("Agent prompt cannot be empty");
      const options = selectedOptions(context.inputState);
      const repositoryPath =
        options.repository ??
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        process.cwd();
      const run = (await this.control({
        action: "run.create",
        request: {
          prompt,
          model: options.model,
          permissionMode: permissionMode(options.permission),
          runtimeId: options.runtime,
          workspace: { location: "local", repositoryPath },
        },
      })) as AgentRun;
      const item = this.itemFromRun(run);
      this.itemsByRunId.set(run.id, item);
      controller.items.add(item);
      return item;
    };
    controller.forkHandler = async (resource) => {
      const sourceId = this.runIdFromResource(resource);
      const duplicate = (await this.control({
        action: "run.duplicate",
        runId: sourceId,
      })) as AgentRun;
      const item = this.itemFromRun(duplicate);
      controller.items.add(item);
      return item;
    };
    controller.getChatSessionInputState = async (_resource, context) => {
      if (context.previousInputState) return context.previousInputState;
      const folders = (vscode.workspace.workspaceFolders ?? []).map(
        (folder) => ({
          id: folder.uri.fsPath,
          name: folder.name,
          description: folder.uri.fsPath,
          icon: new vscode.ThemeIcon("folder"),
        }),
      );
      const repositoryItems =
        folders.length > 0
          ? folders
          : [
              {
                id: process.cwd(),
                name: "Current workspace",
                description: process.cwd(),
                icon: new vscode.ThemeIcon("folder"),
              },
            ];
      const permissionItems: NativeChatSessionOptionItem[] = [
        { id: "autonomous", name: "Autonomous" },
        { id: "ask", name: "Ask before tools" },
        { id: "readOnly", name: "Read only" },
        { id: "fullAccess", name: "Full access" },
      ];
      const runtimeItems: NativeChatSessionOptionItem[] = [
        { id: "local", name: "Local" },
        { id: "container", name: "Docker" },
        { id: "ssh", name: "SSH" },
      ];
      return controller.createChatSessionInputState([
        {
          id: "repository",
          name: "Repository",
          items: repositoryItems,
          selected: repositoryItems[0],
        },
        {
          id: "permission",
          name: "Permission mode",
          items: permissionItems,
          selected: permissionItems[0],
        },
        {
          id: "runtime",
          name: "Runtime",
          items: runtimeItems,
          selected: runtimeItems[0],
        },
      ]);
    };
    controller.resolveChatSessionItem = async (item, token) => {
      if (token.isCancellationRequested) return;
      const runId = this.runIdFromResource(item.resource);
      const events = await this.messenger.externalRequest("agents/events", {
        runId,
        options: { limit: 5_000 },
      });
      if (token.isCancellationRequested) return;
      item.changes = changedFilesFromEvents(events);
      controller.items.add(item);
    };
    if (controller.onDidChangeChatSessionItemState) {
      this.disposables.push(
        controller.onDidChangeChatSessionItemState(async (item) => {
          await this.control({
            action: item.archived ? "archive" : "unarchive",
            runId: this.runIdFromResource(item.resource),
          });
          await this.refresh();
        }),
      );
    }
  }

  private async provideSession(
    resource: vscode.Uri,
    token: vscode.CancellationToken,
    inputState: NativeChatSessionInputState,
  ): Promise<Record<string, unknown>> {
    const runId = this.runIdFromResource(resource);
    this.currentRunId = runId;
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.activeAgentSession",
      runId,
    );
    await this.context.workspaceState.update(
      "qivryn.nativeAgent.lastRunId",
      runId,
    );
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.composerLocation",
      this.isAgentsWindow ? "dedicatedWindow" : "editorTab",
    );
    const runs = await this.listRuns();
    const run = runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Qivryn agent ${runId} was not found`);
    await this.updateActiveRunContext(run);
    const events = await this.messenger.externalRequest("agents/events", {
      runId,
      options: { limit: 5_000 },
    });
    const history = this.historyFromRun(run, events);
    const lastSequence = events.at(-1)?.sequence ?? 0;
    const options = Object.fromEntries(
      inputState.groups
        .filter((group) => group.selected)
        .map((group) => [group.id, { ...group.selected, locked: true }]),
    );
    return {
      title: run.title,
      history,
      options,
      activeResponseCallback: TERMINAL_STATUSES.has(run.status)
        ? undefined
        : async (stream: NativeResponseStream) =>
            this.streamRun(runId, lastSequence, stream, token),
      requestHandler: async (
        request: NativeChatRequest,
        _context: unknown,
        stream: NativeResponseStream,
        requestToken: vscode.CancellationToken,
      ) => {
        if (await this.resolveApprovalsFromRequest(request)) return {};
        await this.submitFollowUp(runId, request.prompt, stream, requestToken);
        return {};
      },
    };
  }

  private async submitFollowUp(
    runId: string,
    prompt: string,
    stream: NativeResponseStream,
    token: vscode.CancellationToken,
  ) {
    const normalized = prompt.trim();
    if (!normalized) return;
    const run = (await this.listRuns()).find(
      (candidate) => candidate.id === runId,
    );
    const before = await this.messenger.externalRequest("agents/events", {
      runId,
      options: { limit: 5_000 },
    });
    await this.control({
      action: "queue.add",
      runId,
      prompt: normalized,
      behavior: run?.status === "running" ? "steer" : "run-next",
    });
    if (run && TERMINAL_STATUSES.has(run.status) && run.status !== "archived") {
      await this.control({ action: "run.resume", runId });
    }
    await this.streamRun(runId, before.at(-1)?.sequence ?? 0, stream, token);
  }

  private async streamRun(
    runId: string,
    afterSequence: number,
    stream: NativeResponseStream,
    token: vscode.CancellationToken,
  ) {
    stream.progress("Qivryn agent is working…");
    const source = await this.messenger.externalRequest("agents/stream", {
      runId,
      options: { afterSequence },
    });
    for await (const event of source) {
      if (token.isCancellationRequested || this.disposed) return;
      for (const item of projectAgentTranscript([event])) {
        this.renderTranscriptItem(stream, item);
      }
    }
    await this.refresh();
  }

  private renderTranscriptItem(
    stream: NativeResponseStream,
    item: QivrynTranscriptItem,
  ) {
    const nativeParts = nativeResponseParts(item);
    if (stream.push && nativeParts.length > 0) {
      for (const part of nativeParts) stream.push(part);
      return;
    }
    if (item.type === "message") {
      if (item.role === "assistant") stream.markdown(item.text);
      return;
    }
    if (item.type === "reasoning") {
      stream.progress(item.text);
      return;
    }
    if (item.type === "tool") {
      const detail = item.detail ? ` — ${item.detail}` : "";
      stream.markdown(`**${item.name}**${detail}\n\n${item.output ?? ""}`);
      return;
    }
    if (item.type === "approval") {
      stream.markdown(`**Approval required:** ${item.approval.title}`);
      if (stream.button) {
        stream.button({
          command: "qivryn.resolveAgentApproval",
          title: "Approve",
          arguments: [item.runId, item.approval.id, "approve"],
        });
        stream.button({
          command: "qivryn.resolveAgentApproval",
          title: "Reject",
          arguments: [item.runId, item.approval.id, "reject"],
        });
      }
      return;
    }
    if (item.type === "notice") {
      stream.progress(item.text);
      return;
    }
    stream.markdown(
      `**${item.title}**${item.detail ? `\n\n${item.detail}` : ""}`,
    );
  }

  private historyFromRun(run: AgentRun, events: AgentEvent[]): unknown[] {
    const runtime = vscode as unknown as Record<
      string,
      new (...args: any[]) => any
    >;
    const RequestTurn = runtime.ChatRequestTurn2 ?? runtime.ChatRequestTurn;
    const ResponseTurn = runtime.ChatResponseTurn2 ?? runtime.ChatResponseTurn;
    const MarkdownPart = runtime.ChatResponseMarkdownPart;
    if (!RequestTurn || !ResponseTurn || !MarkdownPart) return [];
    const transcript = projectAgentTranscript(events);
    const history: unknown[] = [];
    let responseParts: unknown[] = [];
    const flushResponse = () => {
      if (responseParts.length === 0) return;
      history.push(new ResponseTurn(responseParts, {}, PARTICIPANT_ID));
      responseParts = [];
    };
    if (
      !transcript.some(
        (item) => item.type === "message" && item.role === "user",
      )
    ) {
      history.push(
        new RequestTurn(
          run.prompt,
          undefined,
          [],
          PARTICIPANT_ID,
          [],
          undefined,
          undefined,
          run.model,
          undefined,
        ),
      );
    }
    for (const item of transcript) {
      if (item.type === "message" && item.role === "user") {
        flushResponse();
        history.push(
          new RequestTurn(
            item.text,
            undefined,
            [],
            PARTICIPANT_ID,
            [],
            undefined,
            item.id,
            run.model,
            undefined,
          ),
        );
        continue;
      }
      const parts = nativeResponseParts(item);
      if (parts.length === 0) {
        const text = transcriptMarkdown(item);
        if (!text) continue;
        parts.push(new MarkdownPart(new vscode.MarkdownString(text)));
      }
      responseParts.push(...parts);
    }
    flushResponse();
    return history;
  }

  private async refresh() {
    if (this.disposed || !this.controller) return;
    try {
      const runs = filterAgentRuns(await this.listRuns(), undefined);
      const items = runs.map((run) => {
        const item = this.itemFromRun(run);
        this.itemsByRunId.set(run.id, item);
        return item;
      });
      this.controller.items.replace(items);
      const activeRun = runs.find((run) => run.id === this.currentRunId);
      if (activeRun) await this.updateActiveRunContext(activeRun);
      await vscode.commands.executeCommand(
        "setContext",
        "qivryn.hasNativeAgentSessions",
        items.length > 0,
      );
      await vscode.commands.executeCommand(
        "setContext",
        "qivryn.agentNeedsAttention",
        runs.some(
          (run) => run.status === "attention" || run.status === "waiting",
        ),
      );
      await this.closeStartupPlaceholders();
    } catch (error) {
      console.warn("[Qivryn] Failed to refresh native agent sessions", error);
    }
  }

  private itemFromRun(run: AgentRun): NativeChatSessionItem {
    const item = this.controller!.createChatSessionItem(
      this.resourceForRun(run.id),
      run.title || run.prompt.slice(0, 80),
    );
    item.description = run.workspace.branch ?? run.workspace.repositoryPath;
    item.badge =
      run.diffAdded || run.diffRemoved
        ? `+${run.diffAdded ?? 0} −${run.diffRemoved ?? 0}`
        : undefined;
    item.status = nativeStatus(run.status);
    item.archived = run.status === "archived" || run.archived === true;
    item.timing = {
      created: Date.parse(run.createdAt),
      lastRequestStarted: run.startedAt ? Date.parse(run.startedAt) : undefined,
      lastRequestEnded: run.finishedAt ? Date.parse(run.finishedAt) : undefined,
    };
    item.metadata = toQivrynAgentSessionMetadata(run) as unknown as Record<
      string,
      unknown
    >;
    item.tooltip = new vscode.MarkdownString(
      `**${run.title}**\n\n${run.workspace.repositoryPath}\n\n${run.statusReason ?? run.status}`,
    );
    item.iconPath = new vscode.ThemeIcon(
      run.status === "running" || run.status === "queued"
        ? "loading~spin"
        : run.status === "attention" || run.status === "waiting"
          ? "circle-filled"
          : run.parentRunId
            ? "git-branch"
            : "circle-outline",
    );
    return item;
  }

  private async closeStartupPlaceholders(): Promise<void> {
    const placeholders = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.filter((tab) => {
        const input = tab.input as
          | {
              uri?: vscode.Uri;
              resource?: vscode.Uri;
              sessionResource?: vscode.Uri;
              constructor?: { name?: string };
            }
          | undefined;
        const uri = input?.uri ?? input?.resource ?? input?.sessionResource;
        const inputName = input?.constructor?.name ?? "";
        const isLegacyAgentEditor =
          uri?.scheme === SESSION_SCHEME ||
          uri?.toString().includes(SESSION_SCHEME) ||
          inputName === "ChatEditorTabInput" ||
          tab.label === "Qivryn Agent" ||
          tab.label.endsWith(" | Qivryn Agent");
        return (
          isLegacyAgentEditor || (!tab.isActive && tab.label === "Welcome")
        );
      }),
    );
    if (placeholders.length > 0) {
      await vscode.window.tabGroups.close(placeholders, true);
    }
  }

  private async resolveApprovalsFromRequest(
    request: NativeChatRequest,
  ): Promise<boolean> {
    const decisions: Array<{ data: unknown; decision: "approve" | "reject" }> =
      [
        ...(request.acceptedConfirmationData ?? []).map((data) => ({
          data,
          decision: "approve" as const,
        })),
        ...(request.rejectedConfirmationData ?? []).map((data) => ({
          data,
          decision: "reject" as const,
        })),
      ];
    let resolved = false;
    for (const { data, decision } of decisions) {
      if (!isRecord(data) || data.type !== "qivryn.approval") continue;
      if (typeof data.runId !== "string" || typeof data.approvalId !== "string")
        continue;
      await this.control({
        action: "approval.resolve",
        runId: data.runId,
        approvalId: data.approvalId,
        decision,
      });
      resolved = true;
    }
    if (resolved) await this.refresh();
    return resolved;
  }

  private listRuns(): Promise<AgentRun[]> {
    return this.messenger.externalRequest("agents/list", {
      includeArchived: true,
      limit: 1_000,
    });
  }

  private control(request: AgentControlRequest) {
    return this.messenger.externalRequest("agents/control", request);
  }

  private resourceForRun(runId: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SESSION_SCHEME,
      authority: "run",
      path: `/${encodeURIComponent(runId)}`,
    });
  }

  private runIdFromResource(resource: vscode.Uri): string {
    if (resource.scheme !== SESSION_SCHEME) {
      throw new Error(`Unsupported Qivryn session URI: ${resource.toString()}`);
    }
    return decodeURIComponent(resource.path.replace(/^\//, ""));
  }

  private runIdFromChatContext(context: unknown): string | undefined {
    const resource = (
      context as {
        chatSessionContext?: { chatSessionItem?: { resource?: vscode.Uri } };
      }
    )?.chatSessionContext?.chatSessionItem?.resource;
    return resource ? this.runIdFromResource(resource) : undefined;
  }

  private resourceFromCommandInput(
    input: string | vscode.Uri | { resource?: vscode.Uri },
  ): vscode.Uri {
    if (input instanceof vscode.Uri) return input;
    if (typeof input === "object" && input?.resource) return input.resource;
    if (typeof input === "string" && input.startsWith(`${SESSION_SCHEME}:`)) {
      return vscode.Uri.parse(input);
    }
    if (typeof input === "string" && input.length > 0) {
      return this.resourceForRun(input);
    }
    throw new Error("A Qivryn agent session is required");
  }

  private activeRunId(): string | undefined {
    return this.currentRunId ?? [...this.itemsByRunId.keys()][0];
  }

  private async currentRun(): Promise<AgentRun | undefined> {
    const runId = this.activeRunId();
    if (!runId) return undefined;
    return (await this.listRuns()).find((run) => run.id === runId);
  }

  private async updateActiveRunContext(run: AgentRun): Promise<void> {
    await Promise.all([
      vscode.commands.executeCommand(
        "setContext",
        "qivryn.activeAgentStatus",
        run.status,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "qivryn.activeAgentPinned",
        run.pinned === true,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "qivryn.activeAgentTerminal",
        TERMINAL_STATUSES.has(run.status),
      ),
    ]);
  }

  private async refreshWindowContext(): Promise<void> {
    this.isAgentsWindow =
      (await vscode.commands.executeCommand<boolean | undefined>(
        "getContextKeyValue",
        "isSessionsWindow",
      )) === true;
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.isAgentsWindow",
      this.isAgentsWindow,
    );
  }

  private async restoreHandoffSession(): Promise<void> {
    const runId =
      this.context.globalState.get<string>("qivryn.nativeAgent.handoffRunId") ??
      this.context.workspaceState.get<string>("qivryn.nativeAgent.lastRunId");
    if (!runId) return;
    this.currentRunId = runId;
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.activeAgentSession",
      runId,
    );
    if (!this.isAgentsWindow) return;
    await vscode.commands.executeCommand(
      "qivryn.openNativeAgent",
      this.resourceForRun(runId),
    );
    await this.context.globalState.update(
      "qivryn.nativeAgent.handoffRunId",
      undefined,
    );
  }
}

function changedFilesFromEvents(
  events: AgentEvent[],
): NativeChatSessionItem["changes"] {
  const changes = new Map<
    string,
    NonNullable<NativeChatSessionItem["changes"]>[number]
  >();
  for (const event of events) {
    if (event.kind !== "file.changed") continue;
    const payload = event.payload as {
      path?: string;
      filepath?: string;
      originalPath?: string;
      modifiedPath?: string;
      insertions?: number;
      deletions?: number;
    };
    const filepath = payload.path ?? payload.filepath;
    if (!filepath) continue;
    const previous = changes.get(filepath);
    changes.set(filepath, {
      uri: vscode.Uri.file(filepath),
      originalUri: payload.originalPath
        ? vscode.Uri.file(payload.originalPath)
        : previous?.originalUri,
      modifiedUri: payload.modifiedPath
        ? vscode.Uri.file(payload.modifiedPath)
        : vscode.Uri.file(filepath),
      insertions: (previous?.insertions ?? 0) + (payload.insertions ?? 0),
      deletions: (previous?.deletions ?? 0) + (payload.deletions ?? 0),
    });
  }
  return [...changes.values()];
}

function selectedOptions(state: NativeChatSessionInputState) {
  return Object.fromEntries(
    state.groups.map((group) => [group.id, group.selected?.id]),
  ) as Record<string, string | undefined>;
}

function permissionMode(value?: string): AgentRun["permissionMode"] {
  return ["ask", "autonomous", "fullAccess", "readOnly"].includes(value ?? "")
    ? (value as AgentRun["permissionMode"])
    : "autonomous";
}

function nativeStatus(status: AgentRun["status"]): number {
  if (status === "failed") return 0;
  if (["completed", "canceled", "archived"].includes(status)) return 1;
  if (status === "attention" || status === "waiting") return 3;
  return 2;
}

function nativeResponseParts(item: QivrynTranscriptItem): unknown[] {
  const runtime = vscode as unknown as Record<
    string,
    new (...args: any[]) => any
  >;
  const MarkdownPart = runtime.ChatResponseMarkdownPart;
  const ThinkingPart = runtime.ChatResponseThinkingProgressPart;
  const ToolPart = runtime.ChatToolInvocationPart;
  const SubagentData = runtime.ChatSubagentToolInvocationData;
  const MultiDiffPart = runtime.ChatResponseMultiDiffPart;
  const ConfirmationPart = runtime.ChatResponseConfirmationPart;
  const InfoPart = runtime.ChatResponseInfoPart;
  const WarningPart = runtime.ChatResponseWarningPart;

  if (item.type === "message") {
    return item.role === "assistant" && MarkdownPart
      ? [new MarkdownPart(new vscode.MarkdownString(item.text))]
      : [];
  }
  if (item.type === "reasoning") {
    if (ThinkingPart)
      return [new ThinkingPart(item.text, `qivryn-reasoning-${item.id}`)];
    return MarkdownPart
      ? [new MarkdownPart(new vscode.MarkdownString(`> ${item.text}`))]
      : [];
  }
  if (item.type === "tool" && ToolPart) {
    const part = new ToolPart(
      item.name,
      item.toolCallId,
      item.status === "failed" ? (item.output ?? item.detail) : undefined,
    );
    part.isError = item.status === "failed";
    part.isComplete = item.status !== "running";
    part.invocationMessage = item.detail ?? item.name;
    part.pastTenseMessage =
      item.status === "failed"
        ? `${item.name} failed`
        : item.status === "completed"
          ? `${item.name} completed`
          : undefined;
    if (looksLikeTerminalTool(item.name, item.detail)) {
      part.toolSpecificData = {
        commandLine: { original: item.detail ?? item.name },
        language: "shell",
        output: item.output ? { text: item.output } : undefined,
      };
    } else {
      part.toolSpecificData = {
        input: item.detail ?? "",
        output: item.output ?? "",
      };
    }
    return [part];
  }
  if (item.type === "approval") {
    const message =
      item.approval.detail ??
      item.approval.command ??
      item.approval.toolName ??
      "This action requires your approval.";
    if (ConfirmationPart) {
      return [
        new ConfirmationPart(
          item.approval.title,
          new vscode.MarkdownString(message),
          {
            type: "qivryn.approval",
            runId: item.runId,
            approvalId: item.approval.id,
          },
          ["Approve", "Reject"],
        ),
      ];
    }
  }
  if (item.type === "fileChange" && MultiDiffPart) {
    const payload = isRecord(item.payload) ? item.payload : {};
    const filepath = stringFrom(
      payload.path ?? payload.filepath ?? payload.modifiedPath,
    );
    if (filepath) {
      const originalPath = stringFrom(payload.originalPath);
      const modifiedPath = stringFrom(payload.modifiedPath) ?? filepath;
      return [
        new MultiDiffPart(
          [
            {
              originalUri: originalPath
                ? vscode.Uri.file(originalPath)
                : undefined,
              modifiedUri: vscode.Uri.file(modifiedPath),
              goToFileUri: vscode.Uri.file(modifiedPath),
              added: numberFrom(payload.insertions),
              removed: numberFrom(payload.deletions),
            },
          ],
          item.title,
        ),
      ];
    }
  }
  if (item.type === "subagent" && ToolPart) {
    const payload = isRecord(item.payload) ? item.payload : {};
    const part = new ToolPart("subagent", item.id);
    part.isComplete = payload.status !== "running";
    part.invocationMessage = item.title;
    part.pastTenseMessage = item.detail ?? item.title;
    part.subAgentInvocationId = stringFrom(payload.subagentRunId ?? payload.id);
    part.toolSpecificData = SubagentData
      ? new SubagentData(
          item.detail,
          stringFrom(payload.name) ?? item.title,
          stringFrom(payload.prompt),
          stringFrom(payload.result ?? payload.output),
        )
      : {
          input: stringFrom(payload.prompt) ?? item.detail ?? "",
          output: stringFrom(payload.result ?? payload.output) ?? "",
        };
    return [part];
  }
  if (item.type === "plan" && ToolPart) {
    const payload = isRecord(item.payload) ? item.payload : {};
    const planItems = Array.isArray(payload.items) ? payload.items : [];
    const part = new ToolPart("plan", item.id);
    part.isComplete = payload.status === "completed";
    part.invocationMessage = item.title;
    part.pastTenseMessage = item.title;
    part.toolSpecificData = {
      todoList: planItems.map((entry, index) => {
        const value = isRecord(entry) ? entry : { title: String(entry) };
        return {
          id: index + 1,
          title: stringFrom(value.title ?? value.text) ?? `Step ${index + 1}`,
          status:
            value.status === "completed" || value.status === "done"
              ? 3
              : value.status === "in_progress" || value.status === "running"
                ? 2
                : 1,
        };
      }),
    };
    return [part];
  }
  if (item.type === "notice") {
    if (item.level !== "info" && WarningPart) {
      return [new WarningPart(new vscode.MarkdownString(item.text))];
    }
    return MarkdownPart
      ? [
          new MarkdownPart(
            new vscode.MarkdownString(
              item.code === "run.progress" ? item.text : `_${item.text}_`,
            ),
          ),
        ]
      : [];
  }
  if (item.type === "checkpoint" && MarkdownPart) {
    return [
      new MarkdownPart(
        new vscode.MarkdownString(
          `_Checkpoint · ${item.title}${item.detail ? ` — ${item.detail}` : ""}_`,
        ),
      ),
    ];
  }
  if (item.type === "artifact" && InfoPart) {
    return [
      new InfoPart(
        new vscode.MarkdownString(
          `**${item.title}**${item.detail ? ` — ${item.detail}` : ""}`,
        ),
      ),
    ];
  }
  return [];
}

function looksLikeTerminalTool(name: string, detail?: string): boolean {
  return (
    /terminal|shell|command|exec|bash|run/i.test(name) ||
    Boolean(
      detail &&
        /(^|\s)(?:cd|git|npm|npx|pnpm|yarn|node|python|pytest|cargo|go|make|cmake|rg|ls|find)\b/.test(
          detail,
        ),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function transcriptMarkdown(item: QivrynTranscriptItem): string | undefined {
  if (item.type === "message")
    return item.role === "assistant" ? item.text : undefined;
  if (item.type === "reasoning") return `> ${item.text}`;
  if (item.type === "tool") {
    return `**${item.name}**${item.detail ? ` — ${item.detail}` : ""}${item.output ? `\n\n\`\`\`text\n${item.output}\n\`\`\`` : ""}`;
  }
  if (item.type === "approval")
    return `**Approval required:** ${item.approval.title}`;
  if (item.type === "notice") return `_${item.text}_`;
  return `**${item.title}**${item.detail ? `\n\n${item.detail}` : ""}`;
}
