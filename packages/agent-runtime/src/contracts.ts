export type AgentRunId = string;
export type AgentEventId = string;
export type AgentCheckpointId = string;
export type AgentArtifactId = string;
export type AgentPlanId = string;

export interface AgentLineAttribution {
  id: string;
  runId: AgentRunId;
  repositoryPath: string;
  workspacePath: string;
  filepath: string;
  absolutePath: string;
  startLine: number;
  endLine: number;
  originalText: string;
  createdAt: string;
  eventSequence?: number;
  checkpointId?: AgentCheckpointId;
}

export type AgentRunStatus =
  | "draft"
  | "queued"
  | "running"
  | "waiting"
  | "attention"
  | "completed"
  | "failed"
  | "canceled"
  | "archived";

export type AgentLocation = "local" | "ssh" | "container" | "remote";

export type AgentPermissionMode =
  | "ask"
  | "autonomous"
  | "fullAccess"
  | "readOnly";

export interface AgentWorkspace {
  id: string;
  location: AgentLocation;
  repositoryPath: string;
  worktreePath?: string;
  branch?: string;
  baseRevision?: string;
  retained?: boolean;
}

export interface AgentWorktreeResult {
  run: AgentRun;
  patch?: string;
  commit?: string;
  mergedInto?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
}

export enum AgentAttachmentKind {
  Image = "image",
}

export enum AgentImageMediaType {
  Gif = "image/gif",
  Jpeg = "image/jpeg",
  Png = "image/png",
  Webp = "image/webp",
}

export interface AgentInputAttachment {
  id: string;
  kind: AgentAttachmentKind.Image;
  name: string;
  mediaType: AgentImageMediaType;
  uri: string;
  sizeBytes: number;
}

export interface AgentRun {
  id: AgentRunId;
  revision: number;
  title: string;
  prompt: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
  subagentModel?: string;
  permissionMode: AgentPermissionMode;
  workspace: AgentWorkspace;
  parentRunId?: AgentRunId;
  pinned?: boolean;
  unread?: boolean;
  archived?: boolean;
  progress?: number;
  diffAdded?: number;
  diffRemoved?: number;
  usage?: AgentUsage;
  statusReason?: string;
  idempotencyKey?: string;
  attachments?: AgentInputAttachment[];
  metadata?: Record<string, unknown>;
  runtimeId?: string;
}

export type AgentEventKind =
  | "run.created"
  | "run.status"
  | "run.progress"
  | "message.user"
  | "message.assistant"
  | "message.reasoning"
  | "tool.started"
  | "tool.output"
  | "tool.completed"
  | "tool.failed"
  | "checkpoint.created"
  | "checkpoint.restored"
  | "queue.added"
  | "queue.updated"
  | "queue.removed"
  | "plan.created"
  | "plan.updated"
  | "artifact.created"
  | "review.finding"
  | "approval.requested"
  | "approval.resolved"
  | "subagent.created"
  | "subagent.updated"
  | "file.changed"
  | "context.compacted"
  | "recovery.started"
  | "recovery.completed"
  | "runtime.notice";

export interface AgentEvent<TPayload = unknown> {
  id: AgentEventId;
  runId: AgentRunId;
  sequence: number;
  kind: AgentEventKind;
  createdAt: string;
  payload: TPayload;
}

export type NewAgentEvent<TPayload = unknown> = Omit<
  AgentEvent<TPayload>,
  "sequence"
>;

export type ExternalAgentEvent = Pick<AgentEvent, "kind" | "payload"> &
  Partial<Pick<AgentEvent, "id" | "createdAt">>;

export interface AgentCheckpoint {
  id: AgentCheckpointId;
  runId: AgentRunId;
  createdAt: string;
  label?: string;
  baseRevision?: string;
  patchArtifactId?: AgentArtifactId;
  metadata?: Record<string, unknown>;
}

export interface AgentArtifact {
  id: AgentArtifactId;
  runId: AgentRunId;
  createdAt: string;
  kind: "patch" | "file" | "log" | "review" | "screenshot" | "recording";
  name: string;
  mediaType?: string;
  uri: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentQueueItem {
  id: string;
  runId: AgentRunId;
  prompt: string;
  position: number;
  createdAt: string;
  behavior: "run-next" | "steer";
}

export interface AgentPlanItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
}

export interface AgentPlan {
  id: AgentPlanId;
  runId: AgentRunId;
  revision: number;
  title: string;
  status: "draft" | "approved" | "rejected" | "completed";
  createdAt: string;
  updatedAt: string;
  items: AgentPlanItem[];
}

export type AgentApprovalDecision = "approve" | "approveAlways" | "reject";

export interface AgentApprovalRequest {
  id: string;
  runId: AgentRunId;
  createdAt: string;
  title: string;
  toolName?: string;
  detail?: string;
  command?: string;
  paths?: string[];
  args?: Record<string, unknown>;
  preview?: Array<{
    type: "text" | "diff" | "checklist";
    content: string;
    color?: string;
    paddingLeft?: number;
  }>;
  status: "pending" | "resolved";
  decision?: AgentApprovalDecision;
  resolvedAt?: string;
}

export interface AgentApprovalResolution {
  approvalId: string;
  runId: AgentRunId;
  decision: AgentApprovalDecision;
  resolvedAt: string;
}

export type QivrynComposerLocation =
  | "pane"
  | "editor"
  | "promptBar"
  | "agentsWindow";

export type QivrynAgentLayoutName =
  | "agent"
  | "editor"
  | "zen"
  | "browser"
  | "review"
  | "maximizedChat";

export interface QivrynAgentLayoutState {
  version: 1;
  layout: QivrynAgentLayoutName;
  sidebarLocation: "left" | "right";
  sidebarWidth: number;
  sidebarVisible: boolean;
  editorVisible: boolean;
  panelVisible: boolean;
  auxiliaryBarVisible: boolean;
  agentsWindowOpen: boolean;
  activeRunId?: AgentRunId;
  selectedRunIds: AgentRunId[];
  pinnedRunIds: AgentRunId[];
  composerLocations: Record<AgentRunId, QivrynComposerLocation>;
}

export interface QivrynAgentSessionMetadata {
  runId: AgentRunId;
  parentRunId?: AgentRunId;
  runtimeId?: string;
  repositoryPath: string;
  worktreePath?: string;
  branch?: string;
  status: AgentRunStatus;
  permissionMode: AgentPermissionMode;
  pinned: boolean;
  unread: boolean;
  diffAdded: number;
  diffRemoved: number;
}

interface QivrynTranscriptItemBase {
  id: string;
  runId: AgentRunId;
  sequence: number;
  createdAt: string;
}

export type QivrynTranscriptItem =
  | (QivrynTranscriptItemBase & {
      type: "message";
      role: "user" | "assistant";
      text: string;
    })
  | (QivrynTranscriptItemBase & {
      type: "reasoning";
      text: string;
    })
  | (QivrynTranscriptItemBase & {
      type: "tool";
      toolCallId: string;
      name: string;
      status: "running" | "completed" | "failed";
      detail?: string;
      output?: string;
    })
  | (QivrynTranscriptItemBase & {
      type: "approval";
      approval: AgentApprovalRequest;
    })
  | (QivrynTranscriptItemBase & {
      type: "plan" | "checkpoint" | "artifact" | "subagent" | "fileChange";
      title: string;
      detail?: string;
      payload: unknown;
    })
  | (QivrynTranscriptItemBase & {
      type: "notice";
      level: "info" | "warning" | "error";
      text: string;
      code?: string;
    });

export interface ReviewRequest {
  id: string;
  runId?: AgentRunId;
  mode: "fast" | "standard" | "deep";
  target:
    | { type: "working-tree" }
    | { type: "staged" }
    | { type: "commit"; revision: string }
    | { type: "branch"; base: string; head: string }
    | { type: "files"; paths: string[] }
    | { type: "pull-request"; url: string };
}

export interface ReviewFinding {
  id: string;
  requestId: string;
  severity: "info" | "warning" | "error";
  title: string;
  body: string;
  filepath: string;
  startLine: number;
  endLine?: number;
  proposedPatch?: string;
  evidence?: string;
  fingerprint?: string;
  originalText?: string;
  updatedAt?: string;
  status: "open" | "fixed" | "dismissed";
}

export interface BrowserSession {
  id: string;
  runId?: AgentRunId;
  createdAt: string;
  updatedAt: string;
  url?: string;
  title?: string;
  visible: boolean;
  locked: boolean;
  recording: "off" | "events" | "full";
  lockOwner?: "user" | "agent";
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  metadata?: Record<string, unknown>;
}

export interface BrowserEvent {
  id: string;
  sessionId: string;
  sequence: number;
  createdAt: string;
  kind:
    | "navigation"
    | "console"
    | "network"
    | "dialog"
    | "download"
    | "screenshot"
    | "dom"
    | "viewport"
    | "recording"
    | "interaction"
    | "lock"
    | "permission"
    | "closed";
  payload: unknown;
}

export interface PermissionDecision {
  policy: "disabled" | "allowedWithPermission" | "allowedWithoutPermission";
  reason?: string;
  sandboxed: boolean;
  elevated: boolean;
}

export interface RuntimeCapabilities {
  local: boolean;
  remote: boolean;
  persistent: boolean;
  worktrees: boolean;
  checkpoints: boolean;
  browser: boolean;
  review: boolean;
  maxConcurrency: number;
}

export interface AgentRuntimeStatus {
  state: "ready" | "starting" | "unavailable";
  checkedAt: string;
  source: "bundled" | "path" | "external";
  capabilities?: RuntimeCapabilities;
  message?: string;
}

export interface CreateAgentRunRequest {
  id?: AgentRunId;
  idempotencyKey?: string;
  title?: string;
  prompt: string;
  model?: string;
  subagentModel?: string;
  permissionMode?: AgentPermissionMode;
  workspace: Omit<AgentWorkspace, "id"> & { id?: string };
  parentRunId?: AgentRunId;
  attachments?: AgentInputAttachment[];
  metadata?: Record<string, unknown>;
  runtimeId?: string;
}

export interface AgentRunSnapshot {
  run: AgentRun;
  events: AgentEvent[];
  queue: AgentQueueItem[];
  checkpoints: AgentCheckpoint[];
  plans: AgentPlan[];
}

export interface ListAgentRunsOptions {
  statuses?: AgentRunStatus[];
  includeArchived?: boolean;
  repositoryPath?: string;
  limit?: number;
}

export interface ReadAgentEventsOptions {
  afterSequence?: number;
  limit?: number;
}

export interface StreamAgentEventsOptions extends ReadAgentEventsOptions {
  signal?: AbortSignal;
  pollIntervalMs?: number;
}

export type AgentControlRequest =
  | { action: "run.create"; request: CreateAgentRunRequest }
  | { action: "run.cancel"; runId: AgentRunId; reason?: string }
  | { action: "run.resume"; runId: AgentRunId }
  | {
      action: "run.duplicate";
      runId: AgentRunId;
      title?: string;
      idempotencyKey?: string;
    }
  | { action: "run.cleanup"; runId: AgentRunId }
  | { action: "worktree.retain"; runId: AgentRunId; retained: boolean }
  | { action: "worktree.rename"; runId: AgentRunId; branch: string }
  | { action: "worktree.export"; runId: AgentRunId }
  | { action: "worktree.merge"; runId: AgentRunId }
  | { action: "rename"; runId: AgentRunId; title: string }
  | {
      action: "permission.set";
      runId: AgentRunId;
      permissionMode: AgentPermissionMode;
    }
  | {
      action: "approval.resolve";
      runId: AgentRunId;
      approvalId: string;
      decision: AgentApprovalDecision;
    }
  | { action: "pin"; runId: AgentRunId; pinned: boolean }
  | { action: "unread"; runId: AgentRunId; unread: boolean }
  | { action: "archive"; runId: AgentRunId }
  | { action: "unarchive"; runId: AgentRunId }
  | {
      action: "queue.add";
      runId: AgentRunId;
      prompt: string;
      behavior?: AgentQueueItem["behavior"];
    }
  | {
      action: "queue.update";
      runId: AgentRunId;
      itemId: string;
      prompt: string;
      behavior: AgentQueueItem["behavior"];
    }
  | { action: "queue.remove"; runId: AgentRunId; itemId: string }
  | { action: "queue.reorder"; runId: AgentRunId; itemIds: string[] }
  | { action: "checkpoint.create"; runId: AgentRunId; label?: string }
  | { action: "checkpoint.restore"; runId: AgentRunId; checkpointId: string }
  | {
      action: "plan.create";
      runId: AgentRunId;
      title: string;
      items: string[];
    }
  | {
      action: "plan.update";
      runId: AgentRunId;
      planId: AgentPlanId;
      title: string;
      items: AgentPlanItem[];
      expectedRevision: number;
    }
  | {
      action: "plan.status";
      runId: AgentRunId;
      planId: AgentPlanId;
      status: AgentPlan["status"];
      expectedRevision: number;
    };

export type AgentControlResult =
  | AgentApprovalResolution
  | AgentCheckpoint
  | AgentRun
  | AgentPlan
  | AgentQueueItem
  | AgentQueueItem[]
  | AgentWorktreeResult
  | void;

export interface AgentRuntimeAdapter {
  readonly capabilities: RuntimeCapabilities;
  initialize(): Promise<void>;
  createRun(request: CreateAgentRunRequest): Promise<AgentRun>;
  getRun(runId: AgentRunId): Promise<AgentRun | undefined>;
  listRuns(options?: ListAgentRunsOptions): Promise<AgentRun[]>;
  readEvents(
    runId: AgentRunId,
    options?: ReadAgentEventsOptions,
  ): Promise<AgentEvent[]>;
  streamEvents(
    runId: AgentRunId,
    options?: StreamAgentEventsOptions,
  ): AsyncIterable<AgentEvent>;
  resumeRun(runId: AgentRunId): Promise<AgentRun>;
  cancelRun(runId: AgentRunId, reason?: string): Promise<AgentRun>;
  duplicateRun(
    runId: AgentRunId,
    title?: string,
    idempotencyKey?: string,
  ): Promise<AgentRun>;
  cleanupRun(runId: AgentRunId): Promise<void>;
  retainWorktree(
    runId: AgentRunId,
    retained: boolean,
  ): Promise<AgentWorktreeResult>;
  renameWorktree(
    runId: AgentRunId,
    branch: string,
  ): Promise<AgentWorktreeResult>;
  exportWorktreePatch(runId: AgentRunId): Promise<AgentWorktreeResult>;
  mergeWorktree(runId: AgentRunId): Promise<AgentWorktreeResult>;
  renameRun(runId: AgentRunId, title: string): Promise<AgentRun>;
  setRunPermission(
    runId: AgentRunId,
    permissionMode: AgentPermissionMode,
  ): Promise<AgentRun>;
  resolveApproval(
    runId: AgentRunId,
    approvalId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalResolution>;
  setRunPinned(runId: AgentRunId, pinned: boolean): Promise<AgentRun>;
  setRunUnread(runId: AgentRunId, unread: boolean): Promise<AgentRun>;
  archiveRun(runId: AgentRunId): Promise<AgentRun>;
  unarchiveRun(runId: AgentRunId): Promise<AgentRun>;
  enqueuePrompt(
    runId: AgentRunId,
    prompt: string,
    behavior?: AgentQueueItem["behavior"],
  ): Promise<AgentQueueItem>;
  listQueue(runId: AgentRunId): Promise<AgentQueueItem[]>;
  updateQueueItem(
    runId: AgentRunId,
    itemId: string,
    update: Pick<AgentQueueItem, "prompt" | "behavior">,
  ): Promise<AgentQueueItem>;
  removeQueueItem(runId: AgentRunId, itemId: string): Promise<void>;
  reorderQueue(runId: AgentRunId, itemIds: string[]): Promise<AgentQueueItem[]>;
  createCheckpoint(runId: AgentRunId, label?: string): Promise<AgentCheckpoint>;
  listCheckpoints(runId: AgentRunId): Promise<AgentCheckpoint[]>;
  restoreCheckpoint(runId: AgentRunId, checkpointId: string): Promise<void>;
  createPlan(
    runId: AgentRunId,
    title: string,
    items: string[],
  ): Promise<AgentPlan>;
  listPlans(runId: AgentRunId): Promise<AgentPlan[]>;
  updatePlan(
    runId: AgentRunId,
    planId: AgentPlanId,
    update: Pick<AgentPlan, "title" | "items">,
    expectedRevision: number,
  ): Promise<AgentPlan>;
  setPlanStatus(
    runId: AgentRunId,
    planId: AgentPlanId,
    status: AgentPlan["status"],
    expectedRevision: number,
  ): Promise<AgentPlan>;
  exportRun(runId: AgentRunId): Promise<AgentRunSnapshot>;
  importRun(
    snapshot: AgentRunSnapshot,
    workspace?: Partial<AgentWorkspace>,
  ): Promise<AgentRun>;
  ingestEvents(
    runId: AgentRunId,
    events: ExternalAgentEvent[],
  ): Promise<AgentEvent[]>;
}
