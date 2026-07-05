import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVE_RUN_STATUSES,
  AGENT_LIVE_RUN_STATUSES,
  filterAgentRuns,
  formatAgentRunStatus,
  matchesAgentRunSearch,
  normalizeQivrynAgentLayoutState,
  projectAgentTranscript,
  toQivrynAgentSessionMetadata,
  type AgentEvent,
  type AgentRun,
} from "../src/index.js";

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-42",
    revision: 1,
    title: "Refactor authentication",
    prompt: "Update the OAuth callback flow",
    status: "attention",
    statusReason: "Approval required",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:01:00.000Z",
    model: "gpt-5.6-sol",
    permissionMode: "autonomous",
    runtimeId: "ssh",
    workspace: {
      id: "workspace-42",
      location: "ssh",
      repositoryPath: "/srv/qivryn",
      worktreePath: "/srv/qivryn-auth",
      branch: "codex/auth-flow",
    },
    ...overrides,
  };
}

describe("agent presentation contract", () => {
  it("uses one status vocabulary and grouping across every surface", () => {
    expect(formatAgentRunStatus("attention")).toBe("Needs attention");
    expect(formatAgentRunStatus("canceled")).toBe("Canceled");
    expect(AGENT_ACTIVE_RUN_STATUSES.has("attention")).toBe(true);
    expect(AGENT_ACTIVE_RUN_STATUSES.has("completed")).toBe(false);
    expect(AGENT_LIVE_RUN_STATUSES.has("waiting")).toBe(true);
    expect(AGENT_LIVE_RUN_STATUSES.has("attention")).toBe(false);
  });

  it("searches identifiers, status labels, runtimes, and workspace metadata", () => {
    const candidate = run();
    expect(matchesAgentRunSearch(candidate, "auth approval")).toBe(true);
    expect(matchesAgentRunSearch(candidate, "needs attention ssh")).toBe(true);
    expect(matchesAgentRunSearch(candidate, "codex/auth-flow")).toBe(true);
    expect(matchesAgentRunSearch(candidate, "container")).toBe(false);
  });

  it("filters without mutating the source collection", () => {
    const source = [
      run(),
      run({ id: "run-99", title: "Document releases", status: "completed" }),
    ];
    expect(
      filterAgentRuns(source, "completed releases").map(({ id }) => id),
    ).toEqual(["run-99"]);
    expect(filterAgentRuns(source, "")).not.toBe(source);
    expect(source).toHaveLength(2);
  });

  it("maps durable runs to native chat-session metadata", () => {
    expect(toQivrynAgentSessionMetadata(run())).toEqual(
      expect.objectContaining({
        runId: "run-42",
        status: "attention",
        repositoryPath: "/srv/qivryn",
        worktreePath: "/srv/qivryn-auth",
        branch: "codex/auth-flow",
        pinned: false,
        unread: false,
      }),
    );
  });

  it("projects messages, coalesced tools, approvals, and recovery notices", () => {
    const events: AgentEvent[] = [
      event(1, "message.user", { text: "Fix the login flow" }),
      event(2, "tool.started", { toolCallId: "tool-1", name: "Shell" }),
      event(3, "tool.output", { toolCallId: "tool-1", output: "checked" }),
      event(4, "tool.completed", { toolCallId: "tool-1", output: "done" }),
      event(5, "approval.requested", {
        id: "approval-1",
        title: "Run tests?",
        command: "npm test",
      }),
      event(6, "approval.resolved", {
        approvalId: "approval-1",
        decision: "approve",
      }),
      event(7, "context.compacted", { message: "History compacted" }),
    ];
    const transcript = projectAgentTranscript(events);
    expect(transcript).toHaveLength(4);
    expect(transcript[0]).toEqual(
      expect.objectContaining({ type: "message", role: "user" }),
    );
    expect(transcript[1]).toEqual(
      expect.objectContaining({
        type: "tool",
        status: "completed",
        output: "done",
      }),
    );
    expect(transcript[2]).toEqual(
      expect.objectContaining({
        type: "approval",
        approval: expect.objectContaining({
          id: "approval-1",
          status: "resolved",
          decision: "approve",
        }),
      }),
    );
    expect(transcript.at(-1)).toEqual(
      expect.objectContaining({ type: "notice", code: "context.compacted" }),
    );
  });

  it("suppresses heartbeat progress and coalesces repeated notices", () => {
    const transcript = projectAgentTranscript([
      event(1, "run.progress", { text: "Agent is working…" }),
      event(2, "run.progress", { text: "Agent is working…" }),
      event(3, "runtime.notice", { text: "Connected" }),
      event(4, "runtime.notice", { text: "Connected" }),
    ]);
    expect(transcript).toEqual([
      expect.objectContaining({ type: "notice", text: "Connected" }),
    ]);
  });

  it("pairs legacy tools without call IDs and collapses recovery attempts", () => {
    const transcript = projectAgentTranscript([
      event(1, "tool.started", { toolName: "Shell", command: "npm test" }),
      event(2, "tool.completed", { code: 0 }),
      event(3, "runtime.notice", {
        text: "Approaching context limit (200K tokens). Auto-compacting chat history...",
      }),
      event(4, "runtime.notice", {
        text: "Warning: Auto-compaction error: 400 Bad Request. Continuing without compaction...",
      }),
      event(5, "runtime.notice", {
        text: "Approaching context limit (200K tokens). Auto-compacting chat history...",
      }),
      event(6, "runtime.notice", {
        text: "Chat history auto-compacted successfully.",
      }),
    ]);
    expect(transcript).toEqual([
      expect.objectContaining({ type: "tool", status: "completed" }),
      expect.objectContaining({ type: "notice", sequence: 5 }),
      expect.objectContaining({ type: "notice", sequence: 6 }),
    ]);
  });

  it("bounds and sanitizes persisted native layout state", () => {
    expect(
      normalizeQivrynAgentLayoutState({
        version: 1,
        layout: "review",
        sidebarLocation: "right",
        sidebarWidth: 9999,
        selectedRunIds: ["one", "one", 2],
        pinnedRunIds: ["two"],
        composerLocations: { one: "editor", bad: "unknown" },
      }),
    ).toEqual(
      expect.objectContaining({
        layout: "review",
        sidebarLocation: "right",
        sidebarWidth: 640,
        selectedRunIds: ["one"],
        composerLocations: { one: "editor" },
      }),
    );
  });
});

function event(
  sequence: number,
  kind: AgentEvent["kind"],
  payload: unknown,
): AgentEvent {
  return {
    id: `event-${sequence}`,
    runId: "run-42",
    sequence,
    kind,
    createdAt: `2026-07-03T00:00:0${sequence}.000Z`,
    payload,
  };
}
