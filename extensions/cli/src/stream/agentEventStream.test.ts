import { describe, expect, it } from "vitest";
import {
  createAgentEventStreamCallbacks,
  isAgentEventStreamEnabled,
  type AgentStreamRecord,
} from "./agentEventStream.js";

describe("agent event stream", () => {
  it("is explicitly enabled for durable agent workers", () => {
    expect(isAgentEventStreamEnabled({ QIVRYN_AGENT_EVENT_STREAM: "1" })).toBe(
      true,
    );
    expect(isAgentEventStreamEnabled({})).toBe(false);
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
});
