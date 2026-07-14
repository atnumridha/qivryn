import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { toolPermissionManager } from "../permissions/permissionManager.js";

import {
  createAgentEventStreamCallbacks,
  isAgentControlStreamEnabled,
  isAgentEventStreamEnabled,
  startAgentControlStream,
  type AgentStreamRecord,
} from "./agentEventStream.js";

describe("agent event stream", () => {
  it("is explicitly enabled for durable agent workers", () => {
    expect(isAgentEventStreamEnabled({ QIVRYN_AGENT_EVENT_STREAM: "1" })).toBe(
      true,
    );
    expect(isAgentEventStreamEnabled({})).toBe(false);
    expect(
      isAgentControlStreamEnabled({
        QIVRYN_AGENT_EVENT_STREAM: "1",
        QIVRYN_AGENT_CONTROL_STREAM: "1",
      }),
    ).toBe(true);
    expect(
      isAgentControlStreamEnabled({ QIVRYN_AGENT_EVENT_STREAM: "1" }),
    ).toBe(false);
  });

  it("emits incremental assistant and tool records", () => {
    const records: AgentStreamRecord[] = [];
    const callbacks = createAgentEventStreamCallbacks((record) =>
      records.push(record),
    );
    callbacks.onContent?.("Working ");
    callbacks.onContent?.("now");
    callbacks.onToolStart?.("read_file", { path: "README.md" });
    callbacks.onToolResult?.("contents", "read_file", "done");
    callbacks.onCompactionStart?.("Compacting");
    callbacks.onCompactionComplete?.("Compacted");
    callbacks.onRecoveryComplete?.("Recovered");
    callbacks.onToolStart?.("subagent", {
      subagent_name: "reviewer",
      prompt: "Review this",
    });
    callbacks.onToolResult?.("Looks good", "subagent", "done");
    callbacks.onToolStart?.("write_file", { path: "src/app.ts" });
    callbacks.onToolResult?.("saved", "write_file", "done");

    expect(records.map((record) => record.kind)).toEqual([
      "message.assistant",
      "message.assistant",
      "tool.started",
      "tool.completed",
      "recovery.started",
      "context.compacted",
      "recovery.completed",
      "subagent.created",
      "tool.started",
      "tool.completed",
      "subagent.updated",
      "tool.started",
      "tool.completed",
      "file.changed",
    ]);
    expect(records[0].payload).toMatchObject({ text: "Working ", delta: true });
    expect(records[2].payload).toMatchObject({
      toolName: "read_file",
      text: "Using read_file",
    });
  });

  it("emits approval requests with actionable command context", () => {
    const records: AgentStreamRecord[] = [];
    const callbacks = createAgentEventStreamCallbacks((record) =>
      records.push(record),
    );
    callbacks.onToolPermissionRequest?.(
      "Bash",
      { command: "npm test", path: "/workspace" },
      "approval-1",
      undefined,
      "tool-1",
    );
    expect(records).toEqual([
      expect.objectContaining({
        kind: "approval.requested",
        payload: expect.objectContaining({
          id: "approval-1",
          toolName: "Bash",
          toolCallId: "tool-1",
          command: "npm test",
          paths: ["/workspace"],
        }),
      }),
    ]);
  });

  it("keeps concurrent same-name tools distinct and redacts typed text", () => {
    const records: AgentStreamRecord[] = [];
    const callbacks = createAgentEventStreamCallbacks((record) =>
      records.push(record),
    );
    callbacks.onToolStart?.(
      "subagent",
      { subagent_name: "reviewer", prompt: "Review A" },
      "tool-a",
    );
    callbacks.onToolStart?.(
      "subagent",
      { subagent_name: "tester", prompt: "Test B" },
      "tool-b",
    );
    callbacks.onToolResult?.("B done", "subagent", "done", "tool-b");
    callbacks.onToolResult?.("A done", "subagent", "done", "tool-a");
    callbacks.onToolPermissionRequest?.(
      "computer_use",
      {
        action: "type",
        sessionId: "browser-1",
        selector: "#password",
        text: "private-value",
      },
      "approval-type",
      undefined,
      "tool-type",
    );

    const subagentUpdates = records.filter(
      (record) => record.kind === "subagent.updated",
    );
    expect(subagentUpdates.map((record) => record.payload)).toEqual([
      expect.objectContaining({
        conversationId: "tool-b",
        name: "tester",
      }),
      expect.objectContaining({
        conversationId: "tool-a",
        name: "reviewer",
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain("private-value");
    expect(records.at(-1)?.payload.args).toMatchObject({
      action: "type",
      text: "[redacted 13 characters]",
    });
  });

  it("resolves a pending approval from the parent control stream", async () => {
    const input = new PassThrough();
    const stop = startAgentControlStream(input);
    const result = toolPermissionManager.requestPermission({
      name: "Write",
      arguments: { path: "/workspace/app.ts" },
    });
    const approvalId = toolPermissionManager.getPendingRequestIds()[0];
    input.write(
      `${JSON.stringify({
        action: "approval.resolve",
        approvalId,
        decision: "approve",
      })}\n`,
    );
    await expect(result).resolves.toMatchObject({ approved: true });
    stop();
  });

  it("accepts steering only after live delivery succeeds", async () => {
    const input = new PassThrough();
    const records: AgentStreamRecord[] = [];
    const messages: string[] = [];
    const stop = startAgentControlStream(input, {
      steerMessage(message) {
        messages.push(message);
        return "delivered";
      },
      write: (record) => records.push(record),
    });
    input.write(
      `${JSON.stringify({
        action: "message.enqueue",
        queueItemId: "queue-1",
        message: "Focus on the failing test",
      })}\n`,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(messages).toEqual(["Focus on the failing test"]);
    expect(records).toEqual([
      expect.objectContaining({
        kind: "message.user",
        payload: expect.objectContaining({ queueItemId: "queue-1" }),
      }),
      expect.objectContaining({
        kind: "runtime.notice",
        payload: expect.objectContaining({
          type: "steering.accepted",
          queueItemId: "queue-1",
          status: "delivered",
        }),
      }),
    ]);
    stop();
  });

  it("reports deferred without falsely accepting or echoing the message", async () => {
    const input = new PassThrough();
    const records: AgentStreamRecord[] = [];
    const stop = startAgentControlStream(input, {
      steerMessage: () => "deferred",
      write: (record) => records.push(record),
    });
    input.write(
      `${JSON.stringify({
        action: "message.enqueue",
        queueItemId: "queue-2",
        message: "Handle this next",
      })}\n`,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(records).toEqual([
      expect.objectContaining({
        kind: "runtime.notice",
        payload: expect.objectContaining({
          type: "steering.deferred",
          queueItemId: "queue-2",
          status: "deferred",
        }),
      }),
    ]);
    expect(records.some((record) => record.kind === "message.user")).toBe(
      false,
    );
    stop();
  });
});
