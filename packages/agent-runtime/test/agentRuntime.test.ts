import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentDaemonServer,
  FileAgentStore,
  formatQivrynDeepLink,
  GitWorktreeWorkspaceProvider,
  handoffAgentRun,
  HttpAgentRuntimeClient,
  LocalAgentRuntime,
  MemoryAgentStore,
  parseQivrynDeepLink,
  ProcessAgentExecutor,
  recoverInterruptedAgentRuns,
  transitionAgentRun,
  type AgentCheckpoint,
  type AgentEvent,
  type AgentRun,
  type LocalAgentExecutor,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

const temporaryDirectories: string[] = [];

describe("Qivryn deep links", () => {
  it("round-trips agents, checkpoints, reviews, files, and settings", () => {
    const links = [
      { type: "agent", runId: "run / 1" },
      { type: "checkpoint", runId: "run-1", checkpointId: "check/1" },
      { type: "review", reviewId: "review-1" },
      { type: "file", path: "/workspace/a b.ts", line: 42 },
      { type: "settings", section: "permissions" },
    ] as const;
    for (const link of links) {
      expect(parseQivrynDeepLink(formatQivrynDeepLink(link))).toEqual(link);
    }
    expect(parseQivrynDeepLink("not a url")).toBeUndefined();
  });
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    revision: 0,
    title: "Test run",
    prompt: "Inspect the repository",
    status: "queued",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    permissionMode: "autonomous",
    workspace: {
      id: "workspace-1",
      location: "local",
      repositoryPath: "/workspace/repo",
    },
    ...overrides,
  };
}

describe("agent stores", () => {
  it("assigns stable event sequences and deduplicates event IDs", async () => {
    const store = new MemoryAgentStore();
    await store.createRun(createRun());

    const first = await store.appendEvent({
      id: "event-1",
      runId: "run-1",
      kind: "runtime.notice",
      createdAt: "2026-06-29T00:00:01.000Z",
      payload: { text: "started" },
    });
    const duplicate = await store.appendEvent({
      id: "event-1",
      runId: "run-1",
      kind: "runtime.notice",
      createdAt: "2026-06-29T00:00:02.000Z",
      payload: { text: "duplicate" },
    });
    const second = await store.appendEvent({
      id: "event-2",
      runId: "run-1",
      kind: "runtime.notice",
      createdAt: "2026-06-29T00:00:03.000Z",
      payload: { text: "finished" },
    });

    expect(first.sequence).toBe(1);
    expect(duplicate).toEqual(first);
    expect(second.sequence).toBe(2);
    await expect(
      store.readEvents("run-1", { afterSequence: 1 }),
    ).resolves.toEqual([second]);
  });

  it("persists runs and events across file store instances", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qivryn-agents-"));
    temporaryDirectories.push(directory);
    const firstStore = new FileAgentStore(directory);
    await firstStore.createRun(createRun());
    await firstStore.appendEvent({
      id: "event-1",
      runId: "run-1",
      kind: "run.created",
      createdAt: "2026-06-29T00:00:00.000Z",
      payload: {},
    });
    const transitioned = await transitionAgentRun(
      firstStore,
      "run-1",
      "running",
    );

    const reopenedStore = new FileAgentStore(directory);
    await reopenedStore.initialize();

    await expect(reopenedStore.getRun("run-1")).resolves.toEqual(transitioned);
    const events = await reopenedStore.readEvents("run-1");
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("persists queues and checkpoints across file store instances", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qivryn-agents-"));
    temporaryDirectories.push(directory);
    const store = new FileAgentStore(directory);
    await store.createRun(createRun());
    await store.saveQueueItem({
      id: "queue-1",
      runId: "run-1",
      prompt: "Run the tests",
      position: 0,
      createdAt: "2026-06-29T00:00:01.000Z",
      behavior: "run-next",
    });
    await store.saveCheckpoint({
      id: "checkpoint-1",
      runId: "run-1",
      createdAt: "2026-06-29T00:00:02.000Z",
      label: "Before tests",
    });
    await store.savePlan({
      id: "plan-1",
      runId: "run-1",
      revision: 0,
      title: "Implementation",
      status: "draft",
      createdAt: "2026-06-29T00:00:03.000Z",
      updatedAt: "2026-06-29T00:00:03.000Z",
      items: [{ id: "item-1", text: "Build", status: "pending" }],
    });

    const reopened = new FileAgentStore(directory);
    await expect(reopened.listQueue("run-1")).resolves.toMatchObject([
      { id: "queue-1", prompt: "Run the tests" },
    ]);
    await expect(reopened.listCheckpoints("run-1")).resolves.toMatchObject([
      { id: "checkpoint-1", label: "Before tests" },
    ]);
    await expect(reopened.listPlans("run-1")).resolves.toMatchObject([
      { id: "plan-1", title: "Implementation" },
    ]);
  });
});

describe("agent lifecycle", () => {
  it("recovers interrupted work as attention-required", async () => {
    const store = new MemoryAgentStore();
    await store.createRun(createRun({ status: "running" }));

    const recovered = await recoverInterruptedAgentRuns(store);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      status: "attention",
      statusReason: "runtime-recovered",
    });
  });

  it("rejects invalid terminal-state transitions", async () => {
    const store = new MemoryAgentStore();
    await store.createRun(createRun({ status: "completed" }));

    await expect(transitionAgentRun(store, "run-1", "running")).rejects.toThrow(
      "completed -> running",
    );
  });
});

describe("local agent runtime", () => {
  it("limits concurrency and completes queued runs", async () => {
    const store = new MemoryAgentStore();
    let active = 0;
    let peak = 0;
    const executor: LocalAgentExecutor = {
      async execute(run, context) {
        active++;
        peak = Math.max(peak, active);
        await context.emit({
          kind: "message.assistant",
          createdAt: new Date().toISOString(),
          payload: { runId: run.id },
        });
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
        return { diffAdded: 2, diffRemoved: 1 };
      },
    };
    let id = 0;
    const runtime = new LocalAgentRuntime(
      store,
      executor,
      { prepare: async (run) => run.workspace },
      { maxConcurrency: 2, idFactory: () => `id-${++id}` },
    );
    await runtime.initialize();

    const runs = await Promise.all(
      ["one", "two", "three", "four"].map((prompt) =>
        runtime.createRun({
          prompt,
          workspace: {
            location: "local",
            repositoryPath: "/workspace/repo",
          },
        }),
      ),
    );
    await runtime.waitForIdle();

    expect(peak).toBe(2);
    for (const run of runs) {
      await expect(runtime.getRun(run.id)).resolves.toMatchObject({
        status: "completed",
        diffAdded: 2,
        diffRemoved: 1,
      });
    }
  });

  it("makes create and cancel idempotent", async () => {
    const store = new MemoryAgentStore();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new LocalAgentRuntime(
      store,
      {
        async execute(_run, context) {
          await Promise.race([
            blocked,
            new Promise<void>((resolve) =>
              context.signal.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            ),
          ]);
        },
      },
      { prepare: async (run) => run.workspace },
      { idFactory: () => "stable-id" },
    );
    await runtime.initialize();

    const first = await runtime.createRun({
      id: "run-idempotent",
      idempotencyKey: "request-1",
      prompt: "first",
      workspace: { location: "local", repositoryPath: "/workspace/repo" },
    });
    const duplicate = await runtime.createRun({
      idempotencyKey: "request-1",
      prompt: "second",
      workspace: { location: "local", repositoryPath: "/workspace/repo" },
    });
    expect(duplicate.id).toBe(first.id);

    const canceled = await runtime.cancelRun(first.id);
    const canceledAgain = await runtime.cancelRun(first.id);
    release();
    await runtime.waitForIdle();

    expect(canceled.status).toBe("canceled");
    expect(canceledAgain.status).toBe("canceled");
  });

  it("manages metadata, follow-up queues, and checkpoint restore", async () => {
    const store = new MemoryAgentStore();
    let restoredCheckpointId: string | undefined;
    let id = 0;
    const runtime = new LocalAgentRuntime(
      store,
      { execute: async () => ({ status: "completed" }) },
      {
        prepare: async (run) => run.workspace,
        createCheckpoint: async () => ({ baseRevision: "abc123" }),
        restoreCheckpoint: async (_run, checkpoint) => {
          restoredCheckpointId = checkpoint.id;
        },
      },
      { idFactory: () => `generated-${++id}` },
    );
    await runtime.initialize();
    const run = await runtime.createRun({
      id: "managed-run",
      prompt: "Initial task",
      workspace: { location: "local", repositoryPath: "/workspace/repo" },
    });
    await runtime.waitForIdle();

    await expect(
      runtime.renameRun(run.id, "Renamed task"),
    ).resolves.toMatchObject({ title: "Renamed task" });
    await expect(runtime.setRunPinned(run.id, true)).resolves.toMatchObject({
      pinned: true,
    });
    const first = await runtime.enqueuePrompt(run.id, "First follow-up");
    const second = await runtime.enqueuePrompt(
      run.id,
      "Second follow-up",
      "steer",
    );
    await expect(
      runtime.reorderQueue(run.id, [second.id, first.id]),
    ).resolves.toMatchObject([
      { id: second.id, position: 0 },
      { id: first.id, position: 1 },
    ]);
    await runtime.removeQueueItem(run.id, second.id);
    await expect(runtime.listQueue(run.id)).resolves.toMatchObject([
      { id: first.id, position: 0 },
    ]);

    const checkpoint = await runtime.createCheckpoint(run.id, "Before edit");
    expect(checkpoint.baseRevision).toBe("abc123");
    await runtime.restoreCheckpoint(run.id, checkpoint.id);
    expect(restoredCheckpointId).toBe(checkpoint.id);
  });

  it("executes run-next follow-ups in queue order", async () => {
    const store = new MemoryAgentStore();
    const prompts: string[] = [];
    const checkpointLabels: string[][] = [];
    let release!: () => void;
    const firstExecution = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new LocalAgentRuntime(
      store,
      {
        async execute(run) {
          prompts.push(run.prompt);
          checkpointLabels.push(
            (await store.listCheckpoints(run.id)).map(
              (checkpoint) => checkpoint.label ?? "",
            ),
          );
          if (prompts.length === 1) await firstExecution;
          return { status: "completed" };
        },
      },
      { prepare: async (run) => run.workspace },
    );
    await runtime.initialize();
    const run = await runtime.createRun({
      prompt: "Initial",
      workspace: { location: "local", repositoryPath: "/workspace/repo" },
    });
    await runtime.enqueuePrompt(run.id, "Follow-up one");
    await runtime.enqueuePrompt(run.id, "Follow-up two");
    release();
    await runtime.waitForIdle();

    expect(prompts).toEqual(["Initial", "Follow-up one", "Follow-up two"]);
    expect(checkpointLabels.map((labels) => labels.length)).toEqual([1, 2, 3]);
    expect(checkpointLabels.flat()).toContain("Before agent changes");
    expect(
      checkpointLabels.at(-1)?.filter((label) => label === "Before follow-up"),
    ).toHaveLength(2);
    await expect(runtime.listQueue(run.id)).resolves.toEqual([]);
    await expect(runtime.getRun(run.id)).resolves.toMatchObject({
      status: "completed",
      unread: true,
    });
  });

  it("duplicates runs and cleans persisted state idempotently", async () => {
    const store = new MemoryAgentStore();
    const cleaned: string[] = [];
    const runtime = new LocalAgentRuntime(
      store,
      { execute: async () => ({ status: "completed" }) },
      {
        prepare: async (run) => ({
          ...run.workspace,
          worktreePath: `/worktrees/${run.id}`,
        }),
        cleanup: async (workspace) => {
          cleaned.push(workspace.worktreePath!);
        },
      },
    );
    await runtime.initialize();
    const source = await runtime.createRun({
      title: "Source",
      prompt: "Build it",
      model: "model-a",
      workspace: { location: "local", repositoryPath: "/repo" },
    });
    await runtime.waitForIdle();
    const duplicate = await runtime.duplicateRun(source.id);
    const duplicateRetry = await runtime.duplicateRun(source.id);
    expect(duplicateRetry.id).toBe(duplicate.id);
    await runtime.waitForIdle();
    await expect(runtime.getRun(duplicate.id)).resolves.toMatchObject({
      title: "Source copy",
      prompt: "Build it",
      model: "model-a",
      metadata: { duplicatedFromRunId: source.id },
    });
    await runtime.cleanupRun(duplicate.id);
    await runtime.cleanupRun(duplicate.id);
    await expect(runtime.getRun(duplicate.id)).resolves.toBeUndefined();
    expect(cleaned).toContain(`/worktrees/${duplicate.id}`);
  });

  it("streams and cancels a subagent independently from its parent", async () => {
    const store = new MemoryAgentStore();
    let releaseParent!: () => void;
    const parentBlocked = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    const runtime = new LocalAgentRuntime(
      store,
      {
        async execute(run, context) {
          if (!run.parentRunId) {
            await parentBlocked;
            return { status: "completed" };
          }
          await context.emit({
            kind: "run.progress",
            createdAt: new Date().toISOString(),
            payload: { progress: 0.5 },
          });
          await new Promise<void>((resolve) =>
            context.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
          return { status: "completed" };
        },
      },
      { prepare: async (run) => run.workspace },
      { maxConcurrency: 2 },
    );
    await runtime.initialize();
    const parent = await runtime.createRun({
      prompt: "Parent",
      workspace: { location: "local", repositoryPath: "/repo" },
    });
    const child = await runtime.createRun({
      prompt: "Child",
      parentRunId: parent.id,
      workspace: { location: "local", repositoryPath: "/repo" },
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      const statuses = await Promise.all([
        runtime.getRun(parent.id),
        runtime.getRun(child.id),
      ]);
      if (statuses.every((run) => run?.status === "running")) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await runtime.cancelRun(child.id);
    await expect(runtime.getRun(child.id)).resolves.toMatchObject({
      status: "canceled",
      parentRunId: parent.id,
    });
    await expect(runtime.getRun(parent.id)).resolves.toMatchObject({
      status: "running",
    });
    expect(
      (await runtime.readEvents(child.id)).some(
        (event) => event.kind === "run.progress",
      ),
    ).toBe(true);
    releaseParent();
    await runtime.waitForIdle();
    await expect(runtime.getRun(parent.id)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("edits, approves, rejects, and tracks plan progress", async () => {
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      { execute: async () => ({ status: "completed" }) },
      { prepare: async (run) => run.workspace },
    );
    await runtime.initialize();
    const run = await runtime.createRun({
      prompt: "Plan task",
      workspace: { location: "local", repositoryPath: "/repo" },
    });
    await runtime.waitForIdle();
    const plan = await runtime.createPlan(run.id, "Build feature", [
      "Implement",
      "Test",
    ]);
    const updated = await runtime.updatePlan(
      run.id,
      plan.id,
      {
        title: "Build and validate",
        items: [
          { ...plan.items[0], status: "completed" },
          { ...plan.items[1], status: "in_progress" },
        ],
      },
      plan.revision,
    );
    expect(updated.revision).toBe(1);
    expect(updated.items.map((item) => item.status)).toEqual([
      "completed",
      "in_progress",
    ]);
    await expect(
      runtime.updatePlan(
        run.id,
        plan.id,
        { title: plan.title, items: plan.items },
        plan.revision,
      ),
    ).rejects.toThrow("updated by another process");
    const approved = await runtime.setPlanStatus(
      run.id,
      plan.id,
      "approved",
      updated.revision,
    );
    const rejected = await runtime.setPlanStatus(
      run.id,
      plan.id,
      "rejected",
      approved.revision,
    );
    expect(rejected.status).toBe("rejected");
  });
});

describe("git worktree workspace provider", () => {
  it("runs local agents directly when the selected folder is not a Git repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-nongit-test-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    let executionPath: string | undefined;
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      {
        async execute(run) {
          executionPath =
            run.workspace.worktreePath ?? run.workspace.repositoryPath;
          await writeFile(path.join(executionPath, "agent-output.txt"), "ok\n");
          return { status: "completed" };
        },
      },
      new GitWorktreeWorkspaceProvider({
        rootDirectory: path.join(root, "worktrees"),
      }),
    );
    await runtime.initialize();
    const created = await runtime.createRun({
      prompt: "write output",
      workspace: { location: "local", repositoryPath: workspace },
    });

    await runtime.waitForIdle();
    expect(executionPath).toBe(workspace);
    await expect(runtime.getRun(created.id)).resolves.toMatchObject({
      status: "completed",
      workspace: { repositoryPath: workspace, worktreePath: undefined },
    });
    await expect(
      readFile(path.join(workspace, "agent-output.txt"), "utf8"),
    ).resolves.toBe("ok\n");
  });

  it("renames, exports, retains, and merges completed worktrees", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-manage-test-"));
    temporaryDirectories.push(root);
    const repository = path.join(root, "repo");
    await execFileAsync("git", ["init", repository]);
    await writeFile(path.join(repository, "README.md"), "base\n");
    await execFileAsync("git", ["-C", repository, "add", "-A"]);
    await execFileAsync("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const { stdout: targetBranchOutput } = await execFileAsync("git", [
      "-C",
      repository,
      "branch",
      "--show-current",
    ]);
    const targetBranch = targetBranchOutput.trim();
    const provider = new GitWorktreeWorkspaceProvider({
      rootDirectory: path.join(root, "worktrees"),
    });
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      {
        async execute(run) {
          await writeFile(
            path.join(run.workspace.worktreePath!, "feature.txt"),
            "feature\n",
          );
          return { status: "completed" };
        },
      },
      provider,
    );
    await runtime.initialize();
    const created = await runtime.createRun({
      prompt: "feature",
      workspace: { location: "local", repositoryPath: repository },
    });
    await runtime.waitForIdle();
    const renamed = await runtime.renameWorktree(
      created.id,
      "qivryn/test-feature",
    );
    expect(renamed.run.workspace.branch).toBe("qivryn/test-feature");
    const exported = await runtime.exportWorktreePatch(created.id);
    expect(exported.patch).toContain("feature.txt");
    const retained = await runtime.retainWorktree(created.id, true);
    expect(retained.run.workspace.retained).toBe(true);
    const merged = await runtime.mergeWorktree(created.id);
    expect(merged.mergedInto).toBe(targetBranch);
    await expect(
      readFile(path.join(repository, "feature.txt"), "utf8"),
    ).resolves.toBe("feature\n");
  });

  it("copies dirty state and restores checkpoint commits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-worktree-test-"));
    temporaryDirectories.push(root);
    const repository = path.join(root, "repo");
    const worktrees = path.join(root, "worktrees");
    await execFileAsync("git", ["init", repository]);
    await Promise.all([
      writeFile(path.join(repository, "staged.txt"), "base staged\n"),
      writeFile(path.join(repository, "unstaged.txt"), "base unstaged\n"),
    ]);
    await execFileAsync("git", ["-C", repository, "add", "-A"]);
    await execFileAsync("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    await writeFile(path.join(repository, "staged.txt"), "staged change\n");
    await execFileAsync("git", ["-C", repository, "add", "staged.txt"]);
    await writeFile(path.join(repository, "unstaged.txt"), "unstaged change\n");
    await writeFile(path.join(repository, "untracked.txt"), "untracked\n");

    const provider = new GitWorktreeWorkspaceProvider({
      rootDirectory: worktrees,
    });
    const run = createRun({
      id: "worktree-run",
      workspace: {
        id: "workspace-1",
        location: "local",
        repositoryPath: repository,
      },
    });
    run.workspace = await provider.prepare(run);

    await expect(
      readFile(path.join(run.workspace.worktreePath!, "staged.txt"), "utf8"),
    ).resolves.toBe("staged change\n");
    await expect(
      readFile(path.join(run.workspace.worktreePath!, "unstaged.txt"), "utf8"),
    ).resolves.toBe("unstaged change\n");
    await expect(
      readFile(path.join(run.workspace.worktreePath!, "untracked.txt"), "utf8"),
    ).resolves.toBe("untracked\n");

    const checkpoint: AgentCheckpoint = {
      id: "checkpoint-1",
      runId: run.id,
      createdAt: new Date().toISOString(),
      label: "dirty snapshot",
    };
    Object.assign(checkpoint, await provider.createCheckpoint(run, checkpoint));
    await writeFile(
      path.join(run.workspace.worktreePath!, "staged.txt"),
      "later\n",
    );
    await provider.restoreCheckpoint(run, checkpoint);
    await expect(
      readFile(path.join(run.workspace.worktreePath!, "staged.txt"), "utf8"),
    ).resolves.toBe("staged change\n");

    const worktreePath = run.workspace.worktreePath!;
    await provider.cleanup(run.workspace);
    await expect(access(worktreePath)).rejects.toThrow();
  });

  it("prepares four concurrent runs in isolated worktrees", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-parallel-test-"));
    temporaryDirectories.push(root);
    const repository = path.join(root, "repo");
    await execFileAsync("git", ["init", repository]);
    await writeFile(path.join(repository, "README.md"), "parallel\n");
    await execFileAsync("git", ["-C", repository, "add", "-A"]);
    await execFileAsync("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
    const provider = new GitWorktreeWorkspaceProvider({
      rootDirectory: path.join(root, "worktrees"),
    });
    let active = 0;
    let peak = 0;
    let entered = 0;
    let releaseBarrier!: () => void;
    const allPrepared = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      {
        async execute(run) {
          active++;
          peak = Math.max(peak, active);
          entered++;
          if (entered === 4) releaseBarrier();
          await allPrepared;
          await writeFile(
            path.join(run.workspace.worktreePath!, `${run.id}.txt`),
            run.prompt,
          );
          await new Promise((resolve) => setTimeout(resolve, 25));
          active--;
          return { status: "completed" };
        },
      },
      provider,
      { maxConcurrency: 4 },
    );
    await runtime.initialize();
    const runs = await Promise.all(
      ["one", "two", "three", "four"].map((prompt) =>
        runtime.createRun({
          prompt,
          workspace: { location: "local", repositoryPath: repository },
        }),
      ),
    );
    await runtime.waitForIdle();
    const completed = await Promise.all(
      runs.map((run) => runtime.getRun(run.id)),
    );
    expect(peak).toBe(4);
    expect(
      new Set(completed.map((run) => run!.workspace.worktreePath)).size,
    ).toBe(4);
    expect(completed.every((run) => run?.status === "completed")).toBe(true);
    await Promise.all(completed.map((run) => provider.cleanup(run!.workspace)));
  });
});

describe("process agent executor", () => {
  it("runs setup before the agent process and cleanup afterward", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "qivryn-process-lifecycle-"),
    );
    temporaryDirectories.push(directory);
    const marker = path.join(directory, "order.txt");
    const appendMarker = (value: string) => [
      "-e",
      `require("node:fs").appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${value}\n`)})`,
    ];
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      new ProcessAgentExecutor({
        resolveProcess: () => ({
          command: process.execPath,
          args: appendMarker("main"),
          setup: [{ command: process.execPath, args: appendMarker("setup") }],
          cleanup: [
            { command: process.execPath, args: appendMarker("cleanup") },
          ],
        }),
      }),
      { prepare: async (run) => run.workspace },
    );
    await runtime.initialize();
    await runtime.createRun({
      prompt: "Lifecycle",
      workspace: { location: "local", repositoryPath: directory },
    });
    await runtime.waitForIdle();

    await expect(readFile(marker, "utf8")).resolves.toBe(
      "setup\nmain\ncleanup\n",
    );
  });

  it("records headless agent stdout as assistant conversation", async () => {
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      new ProcessAgentExecutor({
        stdoutEventKind: "message.assistant",
        resolveProcess: () => ({
          command: process.execPath,
          args: ["-e", "process.stdout.write('Agent response')"],
        }),
      }),
      { prepare: async (run) => run.workspace },
    );
    await runtime.initialize();
    const run = await runtime.createRun({
      prompt: "Respond",
      workspace: { location: "local", repositoryPath: process.cwd() },
    });
    await runtime.waitForIdle();
    expect(await runtime.readEvents(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message.assistant",
          payload: expect.objectContaining({ text: "Agent response" }),
        }),
      ]),
    );
  });

  it("persists structured assistant and tool events before the process exits", async () => {
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      new ProcessAgentExecutor({
        stdoutEventKind: "message.assistant",
        stdoutProtocol: "qivryn-agent-events",
        progressIntervalMs: 0,
        resolveProcess: () => ({
          command: process.execPath,
          args: [
            "-e",
            [
              "const emit = (kind, payload) => console.log(JSON.stringify({ kind, payload }));",
              "emit('message.assistant', { text: 'Working ', delta: true });",
              "setTimeout(() => emit('tool.started', { text: 'Using read_file', toolName: 'read_file' }), 100);",
            ].join(" "),
          ],
        }),
      }),
      { prepare: async (run) => run.workspace },
    );
    await runtime.initialize();
    const run = await runtime.createRun({
      prompt: "Stream",
      workspace: { location: "local", repositoryPath: process.cwd() },
    });

    let liveEvents: AgentEvent[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      liveEvents = await runtime.readEvents(run.id);
      if (liveEvents.some((event) => event.kind === "message.assistant")) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(liveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message.assistant",
          payload: expect.objectContaining({ text: "Working ", delta: true }),
        }),
      ]),
    );

    await runtime.waitForIdle();
    expect(await runtime.readEvents(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool.started",
          payload: expect.objectContaining({ toolName: "read_file" }),
        }),
      ]),
    );
  });

  it("streams output and releases immediately after cancellation", async () => {
    const store = new MemoryAgentStore();
    const runtime = new LocalAgentRuntime(
      store,
      new ProcessAgentExecutor({
        terminateGraceMs: 50,
        resolveProcess: () => ({
          command: process.execPath,
          args: ["-e", "console.log('ready'); setInterval(() => {}, 1000)"],
        }),
      }),
      { prepare: async (run) => run.workspace },
    );
    await runtime.initialize();
    const run = await runtime.createRun({
      prompt: "Long process",
      workspace: { location: "local", repositoryPath: process.cwd() },
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await runtime.readEvents(run.id)).some(
          (event) => event.kind === "tool.started",
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const startedAt = Date.now();
    await runtime.cancelRun(run.id);
    await runtime.waitForIdle();
    expect(Date.now() - startedAt).toBeLessThan(500);
    await expect(runtime.getRun(run.id)).resolves.toMatchObject({
      status: "canceled",
    });
    expect(
      (await runtime.readEvents(run.id)).some(
        (event) => event.kind === "tool.failed",
      ),
    ).toBe(true);
  });
});

describe("agent daemon transport", () => {
  it("ingests authenticated loopback NDJSON into the resumable event stream", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      { execute: async () => void (await blocked) },
      { prepare: async (run) => run.workspace },
    );
    const server = new AgentDaemonServer(runtime, { token: "ingest-token" });
    const address = await server.start();
    try {
      const client = new HttpAgentRuntimeClient({
        baseUrl: address.baseUrl,
        token: "ingest-token",
      });
      const run = await client.createRun({
        prompt: "External events",
        workspace: { location: "local", repositoryPath: process.cwd() },
      });
      const ingested = await client.ingestEvents(run.id, [
        {
          kind: "runtime.notice",
          payload: { source: "external", state: "ready" },
        },
        { kind: "tool.output", payload: { channel: "stdout", text: "hello" } },
      ]);
      expect(ingested).toHaveLength(2);
      expect(ingested[1].sequence).toBe(ingested[0].sequence + 1);
      expect(
        (await client.readEvents(run.id)).filter(
          (event) =>
            (event.payload as { source?: string }).source === "external",
        ),
      ).toHaveLength(1);
      const wrongType = await fetch(
        `${address.baseUrl}/runs/${run.id}/ingest`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer ingest-token",
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(wrongType.status).toBe(415);
    } finally {
      release();
      await runtime.waitForIdle();
      await server.close();
    }
  });

  it("authenticates clients and resumes event cursors", async () => {
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      {
        async execute(run, context) {
          await context.emit({
            kind: "message.assistant",
            createdAt: new Date().toISOString(),
            payload: { prompt: run.prompt },
          });
          return { status: "completed" };
        },
      },
      { prepare: async (run) => run.workspace },
    );
    const server = new AgentDaemonServer(runtime, { token: "test-token" });
    const address = await server.start();
    try {
      const unauthorized = await fetch(`${address.baseUrl}/health`);
      expect(unauthorized.status).toBe(401);
      const client = new HttpAgentRuntimeClient({
        baseUrl: address.baseUrl,
        token: "test-token",
      });
      await client.initialize();
      const run = await client.createRun({
        prompt: "Daemon task",
        workspace: { location: "local", repositoryPath: process.cwd() },
      });
      await runtime.waitForIdle();
      const firstPage = await client.readEvents(run.id, { limit: 2 });
      expect(firstPage).toHaveLength(2);
      const remaining = await client.readEvents(run.id, {
        afterSequence: firstPage.at(-1)!.sequence,
      });
      expect(remaining.length).toBeGreaterThan(0);
      const streamed: AgentEvent[] = [];
      for await (const event of client.streamEvents(run.id))
        streamed.push(event);
      expect(streamed.map((event) => event.sequence)).toEqual(
        [...streamed].map((_, index) => index + 1),
      );
      await expect(client.setRunPinned(run.id, true)).resolves.toMatchObject({
        pinned: true,
      });
    } finally {
      await server.close();
    }
  });

  it("cancels an active process from a separate client", async () => {
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      new ProcessAgentExecutor({
        terminateGraceMs: 50,
        resolveProcess: () => ({
          command: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"],
        }),
      }),
      { prepare: async (run) => run.workspace },
    );
    const server = new AgentDaemonServer(runtime, { token: "cancel-token" });
    const address = await server.start();
    try {
      const client = new HttpAgentRuntimeClient({
        baseUrl: address.baseUrl,
        token: "cancel-token",
      });
      const run = await client.createRun({
        prompt: "Cancelable",
        workspace: { location: "local", repositoryPath: process.cwd() },
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await client.getRun(run.id))?.status === "running") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await expect(client.cancelRun(run.id)).resolves.toMatchObject({
        status: "canceled",
      });
      await runtime.waitForIdle();
    } finally {
      await server.close();
    }
  });

  it("keeps runs alive across client disconnect and reconnect", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      { execute: async () => void (await blocked) },
      { prepare: async (run) => run.workspace },
    );
    const server = new AgentDaemonServer(runtime, { token: "reconnect-token" });
    const address = await server.start();
    try {
      const firstClient = new HttpAgentRuntimeClient({
        baseUrl: address.baseUrl,
        token: "reconnect-token",
      });
      const run = await firstClient.createRun({
        prompt: "Background run",
        workspace: { location: "local", repositoryPath: process.cwd() },
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await firstClient.getRun(run.id))?.status === "running") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const reconnectedClient = new HttpAgentRuntimeClient({
        baseUrl: address.baseUrl,
        token: "reconnect-token",
      });
      await expect(reconnectedClient.getRun(run.id)).resolves.toMatchObject({
        status: "running",
      });
      release();
      await runtime.waitForIdle();
      await expect(reconnectedClient.getRun(run.id)).resolves.toMatchObject({
        status: "completed",
      });
    } finally {
      release();
      await server.close();
    }
  });

  it("recovers persisted interrupted runs after daemon restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qivryn-recovery-"));
    temporaryDirectories.push(directory);
    const store = new FileAgentStore(directory);
    await store.initialize();
    await store.createRun(createRun({ status: "running" }));
    const runtime = new LocalAgentRuntime(
      new FileAgentStore(directory),
      { execute: async () => ({ status: "completed" }) },
      { prepare: async (run) => run.workspace },
    );
    const server = new AgentDaemonServer(runtime, { token: "restart-token" });
    const address = await server.start();
    try {
      const client = new HttpAgentRuntimeClient({
        baseUrl: address.baseUrl,
        token: "restart-token",
      });
      await expect(client.getRun("run-1")).resolves.toMatchObject({
        status: "attention",
        statusReason: "runtime-recovered",
      });
    } finally {
      await server.close();
    }
  });
});

describe("runtime handoff", () => {
  it("moves metadata, transcript, queue, checkpoints, and plans without loss", async () => {
    const source = new LocalAgentRuntime(
      new MemoryAgentStore(),
      {
        async execute(_run, context) {
          await context.emit({
            kind: "message.assistant",
            createdAt: new Date().toISOString(),
            payload: { text: "source transcript" },
          });
          return { status: "completed" };
        },
      },
      { prepare: async (run) => run.workspace },
      { runtimeId: "local" },
    );
    const target = new LocalAgentRuntime(
      new MemoryAgentStore(),
      { execute: async () => ({ status: "completed" }) },
      { prepare: async (run) => run.workspace },
      { runtimeId: "ssh:staging" },
    );
    await Promise.all([source.initialize(), target.initialize()]);
    const run = await source.createRun({
      prompt: "Handoff task",
      workspace: { location: "local", repositoryPath: "/repo" },
    });
    await source.waitForIdle();
    await source.enqueuePrompt(run.id, "Qivryn remotely");
    await source.createPlan(run.id, "Remote plan", ["Validate"]);
    const before = await source.exportRun(run.id);
    const imported = await handoffAgentRun(source, target, run.id, {
      location: "ssh",
      repositoryPath: "/remote/repo",
    });

    expect(imported).toMatchObject({
      id: run.id,
      runtimeId: "ssh:staging",
      status: "attention",
      statusReason: "handed-off",
      workspace: { location: "ssh", repositoryPath: "/remote/repo" },
    });
    await expect(source.getRun(run.id)).resolves.toMatchObject({
      status: "archived",
    });
    const after = await target.exportRun(run.id);
    expect(after.events.slice(0, before.events.length)).toEqual(before.events);
    expect(after.queue).toEqual(before.queue);
    expect(after.checkpoints).toEqual(before.checkpoints);
    expect(after.plans).toEqual(before.plans);
  });
});
