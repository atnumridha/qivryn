import { describe, expect, it } from "vitest";
import {
  createAgentDiagnosticReport,
  MemoryAgentStore,
  type AgentRun,
} from "../src/index.js";

describe("redacted runtime diagnostics", () => {
  it("exports health metadata without prompts, payloads, paths, or credentials", async () => {
    const store = new MemoryAgentStore();
    await store.initialize();
    const run: AgentRun = {
      id: "run-1",
      revision: 0,
      title: "Secret customer migration",
      prompt: "API_KEY=top-secret; rewrite proprietary source code",
      status: "failed",
      statusReason: "process-exit-1",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:01.000Z",
      permissionMode: "autonomous",
      workspace: {
        id: "workspace-1",
        location: "local",
        repositoryPath: "/Users/private/customer-project",
        worktreePath: "/Users/private/worktree",
      },
    };
    await store.createRun(run);
    await store.appendEvent({
      id: "event-1",
      runId: run.id,
      kind: "tool.output",
      createdAt: run.updatedAt,
      payload: { text: "proprietary source code and token top-secret" },
    });
    const report = await createAgentDiagnosticReport(store);
    expect(report.runs[0]).toMatchObject({
      id: "run-1",
      status: "failed",
      eventCounts: { "tool.output": 1 },
      hasWorktree: true,
    });
    expect(report.uploadPerformed).toBe(false);
    const serialized = JSON.stringify(report);
    for (const secret of [
      "top-secret",
      "proprietary source code",
      "customer-project",
      "/Users/private",
      "Secret customer migration",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
