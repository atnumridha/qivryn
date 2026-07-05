import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRun,
  AgentRunStatus,
  QivrynAgentLayoutState,
  QivrynAgentSessionMetadata,
  QivrynTranscriptItem,
} from "./contracts.js";

export const AGENT_ACTIVE_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  "draft",
  "queued",
  "running",
  "waiting",
  "attention",
]);

export const AGENT_LIVE_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  "queued",
  "running",
  "waiting",
]);

export const AGENT_RUN_STATUS_LABELS: Readonly<Record<AgentRunStatus, string>> =
  {
    draft: "Draft",
    queued: "Queued",
    running: "Running",
    waiting: "Waiting",
    attention: "Needs attention",
    completed: "Completed",
    failed: "Failed",
    canceled: "Canceled",
    archived: "Archived",
  };

export function formatAgentRunStatus(status: AgentRunStatus): string {
  return AGENT_RUN_STATUS_LABELS[status];
}

function searchableAgentRunValues(run: AgentRun): Array<string | undefined> {
  return [
    run.id,
    run.title,
    run.prompt,
    run.status,
    formatAgentRunStatus(run.status),
    run.statusReason,
    run.model,
    run.subagentModel,
    run.permissionMode,
    run.runtimeId,
    run.workspace.id,
    run.workspace.location,
    run.workspace.repositoryPath,
    run.workspace.worktreePath,
    run.workspace.branch,
    run.workspace.baseRevision,
  ];
}

export function matchesAgentRunSearch(run: AgentRun, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = searchableAgentRunValues(run)
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterAgentRuns(
  runs: readonly AgentRun[],
  query: string | undefined,
): AgentRun[] {
  if (!query?.trim()) return [...runs];
  return runs.filter((run) => matchesAgentRunSearch(run, query));
}

export function toQivrynAgentSessionMetadata(
  run: AgentRun,
): QivrynAgentSessionMetadata {
  return {
    runId: run.id,
    parentRunId: run.parentRunId,
    runtimeId: run.runtimeId,
    repositoryPath: run.workspace.repositoryPath,
    worktreePath: run.workspace.worktreePath,
    branch: run.workspace.branch,
    status: run.status,
    permissionMode: run.permissionMode,
    pinned: run.pinned === true,
    unread: run.unread === true,
    diffAdded: run.diffAdded ?? 0,
    diffRemoved: run.diffRemoved ?? 0,
  };
}

export function createDefaultQivrynAgentLayoutState(): QivrynAgentLayoutState {
  return {
    version: 1,
    layout: "agent",
    sidebarLocation: "left",
    sidebarWidth: 280,
    sidebarVisible: true,
    editorVisible: true,
    panelVisible: false,
    auxiliaryBarVisible: false,
    agentsWindowOpen: false,
    selectedRunIds: [],
    pinnedRunIds: [],
    composerLocations: {},
  };
}

export function normalizeQivrynAgentLayoutState(
  value: unknown,
): QivrynAgentLayoutState {
  const fallback = createDefaultQivrynAgentLayoutState();
  if (!isRecord(value) || value.version !== 1) return fallback;
  const locations: QivrynAgentLayoutState["composerLocations"] = {};
  if (isRecord(value.composerLocations)) {
    for (const [runId, location] of Object.entries(value.composerLocations)) {
      if (
        ["pane", "editor", "promptBar", "agentsWindow"].includes(
          String(location),
        )
      ) {
        locations[runId] =
          location as QivrynAgentLayoutState["composerLocations"][string];
      }
    }
  }
  const layout = [
    "agent",
    "editor",
    "zen",
    "browser",
    "review",
    "maximizedChat",
  ].includes(String(value.layout))
    ? (value.layout as QivrynAgentLayoutState["layout"])
    : fallback.layout;
  const sidebarWidth = Number(value.sidebarWidth);
  return {
    version: 1,
    layout,
    sidebarLocation:
      value.sidebarLocation === "right" ? "right" : fallback.sidebarLocation,
    sidebarWidth:
      Number.isFinite(sidebarWidth) && sidebarWidth >= 214
        ? Math.min(sidebarWidth, 640)
        : fallback.sidebarWidth,
    sidebarVisible: booleanOr(value.sidebarVisible, fallback.sidebarVisible),
    editorVisible: booleanOr(value.editorVisible, fallback.editorVisible),
    panelVisible: booleanOr(value.panelVisible, fallback.panelVisible),
    auxiliaryBarVisible: booleanOr(
      value.auxiliaryBarVisible,
      fallback.auxiliaryBarVisible,
    ),
    agentsWindowOpen: booleanOr(
      value.agentsWindowOpen,
      fallback.agentsWindowOpen,
    ),
    activeRunId:
      typeof value.activeRunId === "string" ? value.activeRunId : undefined,
    selectedRunIds: stringArray(value.selectedRunIds),
    pinnedRunIds: stringArray(value.pinnedRunIds),
    composerLocations: locations,
  };
}

export function projectAgentTranscript(
  events: readonly AgentEvent[],
): QivrynTranscriptItem[] {
  const sortedEvents = [...events].sort((a, b) => a.sequence - b.sequence);
  const projected: QivrynTranscriptItem[] = [];
  const toolItems = new Map<
    string,
    Extract<QivrynTranscriptItem, { type: "tool" }>
  >();
  const noticeKeys = new Set<string>();
  const structuredKeys = new Set<string>();
  const successfulCompaction = [...sortedEvents]
    .reverse()
    .find(
      (event) =>
        event.kind === "context.compacted" ||
        (event.kind === "runtime.notice" &&
          /auto-compacted successfully|history compacted/i.test(
            payloadText(recordPayload(event.payload)),
          )),
    );
  const compactionApproach = successfulCompaction
    ? [...sortedEvents]
        .reverse()
        .find(
          (event) =>
            event.sequence < successfulCompaction.sequence &&
            event.kind === "runtime.notice" &&
            /approaching context limit/i.test(
              payloadText(recordPayload(event.payload)),
            ),
        )
    : undefined;

  for (const event of sortedEvents) {
    const payload = recordPayload(event.payload);
    const base = {
      id: event.id,
      runId: event.runId,
      sequence: event.sequence,
      createdAt: event.createdAt,
    };
    if (event.kind === "message.user" || event.kind === "message.assistant") {
      projected.push({
        ...base,
        type: "message",
        role: event.kind === "message.user" ? "user" : "assistant",
        text: payloadText(payload),
      });
      continue;
    }
    if (event.kind === "message.reasoning") {
      projected.push({
        ...base,
        type: "reasoning",
        text: payloadText(payload),
      });
      continue;
    }
    if (event.kind.startsWith("tool.")) {
      const explicitToolCallId = optionalString(payload.toolCallId);
      const eventToolName =
        optionalString(payload.name ?? payload.toolName) ??
        (payload.scope === "process" ? "Agent process" : undefined);
      const existing = explicitToolCallId
        ? toolItems.get(explicitToolCallId)
        : [...toolItems.values()]
            .reverse()
            .find(
              (candidate) =>
                candidate.status === "running" &&
                (!eventToolName || candidate.name === eventToolName),
            );
      const toolCallId = explicitToolCallId ?? existing?.toolCallId ?? event.id;
      const item: Extract<QivrynTranscriptItem, { type: "tool" }> = {
        ...(existing ?? base),
        type: "tool",
        toolCallId,
        name: eventToolName ?? existing?.name ?? "Tool",
        status:
          event.kind === "tool.failed"
            ? "failed"
            : event.kind === "tool.completed"
              ? "completed"
              : "running",
        detail: optionalString(
          payload.detail ?? payload.command ?? payload.path,
        ),
        output:
          event.kind === "tool.output" || event.kind === "tool.completed"
            ? payloadText(payload)
            : existing?.output,
      };
      if (existing) Object.assign(existing, item);
      else {
        toolItems.set(toolCallId, item);
        projected.push(item);
      }
      continue;
    }
    if (event.kind === "approval.requested") {
      projected.push({
        ...base,
        type: "approval",
        approval: approvalFromEvent(event, payload),
      });
      continue;
    }
    if (event.kind === "approval.resolved") {
      const approvalId = stringValue(payload.approvalId, "");
      const existing = projected.find(
        (item): item is Extract<QivrynTranscriptItem, { type: "approval" }> =>
          item.type === "approval" && item.approval.id === approvalId,
      );
      if (existing) {
        existing.approval = {
          ...existing.approval,
          status: "resolved",
          decision: payload.decision as AgentApprovalRequest["decision"],
          resolvedAt: optionalString(payload.resolvedAt) ?? event.createdAt,
        };
      } else {
        projected.push({
          ...base,
          type: "notice",
          level: "info",
          text: `Approval ${approvalId || "request"} was resolved`,
          code: "approval.resolved",
        });
      }
      continue;
    }

    const structuredType = structuredTranscriptType(event.kind);
    if (structuredType) {
      const title = eventTitle(event.kind, payload);
      const detail = optionalString(
        payload.detail ?? payload.text ?? payload.path,
      );
      const structuredKey = `${structuredType}:${title}:${detail ?? ""}`;
      if (structuredKeys.has(structuredKey)) continue;
      structuredKeys.add(structuredKey);
      projected.push({
        ...base,
        type: structuredType,
        title,
        detail,
        payload: event.payload,
      });
      continue;
    }

    if (
      event.kind === "runtime.notice" ||
      event.kind.startsWith("recovery.") ||
      event.kind === "context.compacted" ||
      event.kind === "run.status" ||
      event.kind === "run.progress"
    ) {
      if (event.kind === "run.progress" || event.kind === "run.status") {
        continue;
      }
      if (
        successfulCompaction &&
        event.kind === "runtime.notice" &&
        isCompactionNotice(payloadText(payload)) &&
        event.sequence !== successfulCompaction.sequence &&
        event.sequence !== compactionApproach?.sequence
      ) {
        continue;
      }
      const text = normalizeNoticeText(
        payloadText(payload) || eventTitle(event.kind, payload),
      );
      const noticeKey = `${event.kind}:${text}`;
      if (noticeKeys.has(noticeKey)) continue;
      noticeKeys.add(noticeKey);
      projected.push({
        ...base,
        type: "notice",
        level:
          payload.level === "error"
            ? "error"
            : payload.level === "warning"
              ? "warning"
              : "info",
        text,
        code: event.kind,
      });
    }
  }
  return projected;
}

function isCompactionNotice(text: string): boolean {
  return /context limit|compact(?:ion|ing|ed)|bounded local summary/i.test(
    text,
  );
}

function normalizeNoticeText(text: string): string {
  if (
    /auto-compaction error|model-based compaction could not complete/i.test(
      text,
    )
  ) {
    return "Context compaction could not complete; Qivryn recovered from durable workspace state.";
  }
  return text.trim();
}

function approvalFromEvent(
  event: AgentEvent,
  payload: Record<string, unknown>,
): AgentApprovalRequest {
  return {
    id: stringValue(payload.id ?? payload.approvalId, event.id),
    runId: event.runId,
    createdAt: event.createdAt,
    title: stringValue(payload.title, "Approval required"),
    toolName: optionalString(payload.toolName ?? payload.name),
    detail: optionalString(payload.detail ?? payload.text),
    command: optionalString(payload.command),
    paths: stringArray(payload.paths),
    status: "pending",
  };
}

function structuredTranscriptType(
  kind: AgentEvent["kind"],
):
  | Extract<
      QivrynTranscriptItem,
      { type: "plan" | "checkpoint" | "artifact" | "subagent" | "fileChange" }
    >["type"]
  | undefined {
  if (kind.startsWith("plan.")) return "plan";
  if (kind.startsWith("checkpoint.")) return "checkpoint";
  if (kind === "artifact.created" || kind === "review.finding")
    return "artifact";
  if (kind.startsWith("subagent.")) return "subagent";
  if (kind === "file.changed") return "fileChange";
  return undefined;
}

function eventTitle(
  kind: AgentEvent["kind"],
  payload: Record<string, unknown>,
): string {
  return stringValue(
    payload.title ?? payload.label ?? payload.name,
    kind
      .split(".")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  );
}

function payloadText(payload: Record<string, unknown>): string {
  for (const key of ["text", "message", "content", "output", "reason"]) {
    const value = payload[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function recordPayload(value: unknown): Record<string, unknown> {
  return isRecord(value)
    ? value
    : { text: typeof value === "string" ? value : "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      ]
    : [];
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
