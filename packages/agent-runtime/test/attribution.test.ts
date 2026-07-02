import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureAgentAttributions,
  FileAttributionStore,
  LocalAgentRuntime,
  MemoryAgentStore,
  parseAgentDiffAttributions,
  type AgentRun,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

function run(workspacePath: string): AgentRun {
  return {
    id: "run-attribution",
    revision: 0,
    title: "Implement parser",
    prompt: "Implement parser",
    status: "completed",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:01.000Z",
    permissionMode: "autonomous",
    workspace: {
      id: "workspace-1",
      location: "local",
      repositoryPath: workspacePath,
      worktreePath: workspacePath,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("agent line attribution", () => {
  it("maps added diff blocks to an originating run, event, and checkpoint", () => {
    const records = parseAgentDiffAttributions(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,0 +2,2 @@",
        "+const generated = true;",
        "+export { generated };",
      ].join("\n"),
      run("/workspace/app"),
      { eventSequence: 12, checkpointId: "checkpoint-1" },
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      runId: "run-attribution",
      filepath: "src/app.ts",
      startLine: 2,
      endLine: 3,
      eventSequence: 12,
      checkpointId: "checkpoint-1",
      originalText: "const generated = true;\nexport { generated };",
    });
  });

  it("persists attribution and reanchors a uniquely moved block", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "continue-attribution-"));
    roots.push(root);
    const filepath = path.join(root, "app.ts");
    await writeFile(filepath, "header\nconst generated = true;\n");
    const store = new FileAttributionStore(path.join(root, "state"));
    await store.initialize();
    await store.replaceRun("run-attribution", [
      {
        id: "attribution-1",
        runId: "run-attribution",
        repositoryPath: root,
        workspacePath: root,
        filepath: "app.ts",
        absolutePath: filepath,
        startLine: 1,
        endLine: 1,
        originalText: "const generated = true;",
        createdAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
    expect((await store.resolveLine(filepath, 2))?.runId).toBe(
      "run-attribution",
    );
  });

  it("captures the real worktree diff after an agent run", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "continue-attribution-git-"),
    );
    const state = await mkdtemp(
      path.join(os.tmpdir(), "continue-attribution-state-"),
    );
    roots.push(root, state);
    await execFileAsync("git", ["-C", root, "init", "-b", "main"]);
    await execFileAsync("git", [
      "-C",
      root,
      "config",
      "user.email",
      "agent@continue.dev",
    ]);
    await execFileAsync("git", [
      "-C",
      root,
      "config",
      "user.name",
      "Continue Agent",
    ]);
    await writeFile(
      path.join(root, "app.ts"),
      "export const initial = true;\n",
    );
    await execFileAsync("git", ["-C", root, "add", "."]);
    await execFileAsync("git", ["-C", root, "commit", "-m", "initial"]);
    await writeFile(
      path.join(root, "app.ts"),
      "export const generated = true;\n",
    );
    const store = new FileAttributionStore(state);
    await store.initialize();
    const records = await captureAgentAttributions(run(root), store);
    expect(records[0]).toMatchObject({ filepath: "app.ts", startLine: 1 });
    expect((await store.resolveLine(path.join(root, "app.ts"), 1))?.runId).toBe(
      "run-attribution",
    );
  });

  it("runs the attribution hook after terminal state is persisted", async () => {
    const hook = vi.fn(async () => undefined);
    const store = new MemoryAgentStore();
    const runtime = new LocalAgentRuntime(
      store,
      { execute: async () => ({ status: "completed" }) },
      { prepare: async (agentRun) => agentRun.workspace },
      { onRunFinished: hook },
    );
    await runtime.initialize();
    const created = await runtime.createRun({
      prompt: "Attribute this",
      permissionMode: "autonomous",
      workspace: { location: "local", repositoryPath: "/workspace/app" },
    });
    await runtime.waitForIdle();
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        status: "completed",
        unread: true,
      }),
    );
  });
});
