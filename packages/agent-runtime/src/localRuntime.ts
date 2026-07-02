import { randomUUID } from "node:crypto";
import { validateAgentAttachments } from "./attachments.js";
import {
  AgentCheckpoint,
  AgentEvent,
  AgentPlan,
  AgentQueueItem,
  AgentRun,
  AgentRunSnapshot,
  AgentRuntimeAdapter,
  AgentWorkspace,
  AgentWorktreeResult,
  CreateAgentRunRequest,
  ExternalAgentEvent,
  ListAgentRunsOptions,
  NewAgentEvent,
  ReadAgentEventsOptions,
  RuntimeCapabilities,
  StreamAgentEventsOptions,
} from "./contracts.js";
import { AgentControlService } from "./controlService.js";
import type { AgentHookExecutor } from "./hooks.js";
import {
  recoverInterruptedAgentRuns,
  transitionAgentRun,
} from "./lifecycle.js";
import { AgentStore, AgentStoreConflictError } from "./store.js";

export interface AgentExecutionContext {
  signal: AbortSignal;
  emit<TPayload>(
    event: Omit<NewAgentEvent<TPayload>, "id" | "runId">,
  ): Promise<void>;
}

export interface AgentExecutionResult {
  status?: "completed" | "failed" | "attention";
  reason?: string;
  diffAdded?: number;
  diffRemoved?: number;
  metadata?: Record<string, unknown>;
}

export interface LocalAgentExecutor {
  execute(
    run: AgentRun,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult | void>;
  cancel?(run: AgentRun): Promise<void>;
}

export interface AgentWorkspaceProvider {
  prepare(run: AgentRun): Promise<AgentWorkspace>;
  cleanup?(workspace: AgentWorkspace): Promise<void>;
  createCheckpoint?(
    run: AgentRun,
    checkpoint: AgentCheckpoint,
  ): Promise<Partial<AgentCheckpoint> | void>;
  restoreCheckpoint?(run: AgentRun, checkpoint: AgentCheckpoint): Promise<void>;
  rename?(run: AgentRun, branch: string): Promise<AgentWorkspace>;
  exportPatch?(run: AgentRun): Promise<string>;
  merge?(run: AgentRun): Promise<{ commit: string; mergedInto: string }>;
}

export interface LocalAgentRuntimeOptions {
  maxConcurrency?: number;
  idFactory?: () => string;
  now?: () => Date;
  autoCheckpoint?: boolean;
  runtimeId?: string;
  onRunFinished?: (run: AgentRun) => Promise<void>;
  capabilities?: Partial<RuntimeCapabilities>;
  hooks?: AgentHookExecutor;
}

export class LocalAgentRuntime implements AgentRuntimeAdapter {
  readonly capabilities: RuntimeCapabilities;
  private readonly maxConcurrency: number;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly autoCheckpoint: boolean;
  private readonly runtimeId: string;
  private readonly onRunFinished?: (run: AgentRun) => Promise<void>;
  private readonly hooks?: AgentHookExecutor;
  private readonly queue: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly controls: AgentControlService;
  private pumping = false;

  constructor(
    private readonly store: AgentStore,
    private readonly executor: LocalAgentExecutor,
    private readonly workspaceProvider: AgentWorkspaceProvider,
    options: LocalAgentRuntimeOptions = {},
  ) {
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.autoCheckpoint = options.autoCheckpoint ?? true;
    this.runtimeId = options.runtimeId ?? "local";
    this.onRunFinished = options.onRunFinished;
    this.hooks = options.hooks;
    this.controls = new AgentControlService(store, {
      idFactory: this.idFactory,
      now: this.now,
      cancelRun: (runId, reason) => this.cancelRun(runId, reason),
      createCheckpoint: async (run, checkpoint) =>
        this.workspaceProvider.createCheckpoint?.(run, checkpoint),
      restoreCheckpoint: (run, checkpoint) => {
        if (!this.workspaceProvider.restoreCheckpoint) {
          throw new Error("This runtime cannot restore checkpoints");
        }
        return this.workspaceProvider.restoreCheckpoint(run, checkpoint);
      },
    });
    this.capabilities = {
      local: true,
      remote: false,
      persistent: true,
      worktrees: true,
      checkpoints: true,
      browser: false,
      review: false,
      maxConcurrency: this.maxConcurrency,
      ...options.capabilities,
    };
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await recoverInterruptedAgentRuns(this.store);
    const queued = await this.store.listRuns({ statuses: ["queued"] });
    this.queue.push(...queued.map((run) => run.id));
    void this.pump();
  }

  async createRun(request: CreateAgentRunRequest): Promise<AgentRun> {
    if (request.idempotencyKey) {
      const existing = await this.store.findRunByIdempotencyKey(
        request.idempotencyKey,
      );
      if (existing) {
        return existing;
      }
    }

    validateAgentAttachments(request.attachments ?? []);

    const now = this.now().toISOString();
    const id = request.id ?? this.idFactory();
    const run: AgentRun = {
      id,
      revision: 0,
      title: request.title?.trim() || request.prompt.trim().slice(0, 80),
      prompt: request.prompt,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      model: request.model,
      subagentModel: request.subagentModel,
      permissionMode: request.permissionMode ?? "autonomous",
      workspace: {
        ...request.workspace,
        id: request.workspace.id ?? this.idFactory(),
      },
      parentRunId: request.parentRunId,
      idempotencyKey: request.idempotencyKey,
      attachments: request.attachments,
      metadata: request.metadata,
      runtimeId: request.runtimeId ?? this.runtimeId,
      unread: false,
    };

    const created = await this.store.createRun(run);
    await this.store.appendEvent({
      id: this.idFactory(),
      runId: created.id,
      kind: "run.created",
      createdAt: now,
      payload: { prompt: created.prompt, workspace: created.workspace },
    });
    if (!this.queue.includes(created.id) && !this.active.has(created.id)) {
      this.queue.push(created.id);
    }
    void this.pump();
    return created;
  }

  getRun(runId: string): Promise<AgentRun | undefined> {
    return this.store.getRun(runId);
  }

  listRuns(options?: ListAgentRunsOptions): Promise<AgentRun[]> {
    return this.store.listRuns(options);
  }

  readEvents(
    runId: string,
    options?: ReadAgentEventsOptions,
  ): Promise<AgentEvent[]> {
    return this.store.readEvents(runId, options);
  }

  async *streamEvents(
    runId: string,
    options: StreamAgentEventsOptions = {},
  ): AsyncIterable<AgentEvent> {
    let cursor = options.afterSequence ?? 0;
    while (!options.signal?.aborted) {
      const events = await this.store.readEvents(runId, {
        afterSequence: cursor,
        limit: options.limit,
      });
      for (const event of events) {
        cursor = event.sequence;
        yield event;
      }
      const run = await this.store.getRun(runId);
      if (
        events.length === 0 &&
        (!run ||
          ["completed", "failed", "canceled", "archived"].includes(run.status))
      ) {
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, options.pollIntervalMs ?? 100),
      );
    }
  }

  async exportRun(runId: string): Promise<AgentRunSnapshot> {
    const run = await this.requireRun(runId);
    const [events, queue, checkpoints, plans] = await Promise.all([
      this.store.readEvents(runId, { limit: Infinity }),
      this.store.listQueue(runId),
      this.store.listCheckpoints(runId),
      this.store.listPlans(runId),
    ]);
    return { run, events, queue, checkpoints, plans };
  }

  async importRun(
    snapshot: AgentRunSnapshot,
    workspace: Partial<AgentWorkspace> = {},
  ): Promise<AgentRun> {
    const existing = await this.store.getRun(snapshot.run.id);
    if (existing) return existing;
    const now = this.now().toISOString();
    const run = await this.store.createRun({
      ...snapshot.run,
      revision: 0,
      status: "attention",
      statusReason: "handed-off",
      updatedAt: now,
      finishedAt: undefined,
      runtimeId: this.runtimeId,
      workspace: {
        ...snapshot.run.workspace,
        worktreePath: undefined,
        branch: undefined,
        baseRevision: undefined,
        ...workspace,
      },
    });
    for (const event of snapshot.events) {
      await this.store.appendEvent({ ...event, runId: run.id });
    }
    for (const item of snapshot.queue) {
      await this.store.saveQueueItem({ ...item, runId: run.id });
    }
    for (const checkpoint of snapshot.checkpoints) {
      await this.store.saveCheckpoint({ ...checkpoint, runId: run.id });
    }
    for (const plan of snapshot.plans) {
      await this.store.savePlan({ ...plan, runId: run.id });
    }
    await this.store.appendEvent({
      id: this.idFactory(),
      runId: run.id,
      kind: "runtime.notice",
      createdAt: now,
      payload: {
        type: "handoff",
        fromRuntimeId: snapshot.run.runtimeId,
        toRuntimeId: this.runtimeId,
      },
    });
    return run;
  }

  async ingestEvents(
    runId: string,
    events: ExternalAgentEvent[],
  ): Promise<AgentEvent[]> {
    await this.requireRun(runId);
    if (events.length > 1_000) {
      throw new Error("NDJSON ingest is limited to 1000 events per request");
    }
    const appended: AgentEvent[] = [];
    for (const event of events) {
      appended.push(
        await this.store.appendEvent({
          id: event.id ?? this.idFactory(),
          runId,
          kind: event.kind,
          createdAt: event.createdAt ?? this.now().toISOString(),
          payload: event.payload,
        }),
      );
    }
    return appended;
  }

  async resumeRun(runId: string): Promise<AgentRun> {
    const run = await transitionAgentRun(
      this.store,
      runId,
      "queued",
      "resumed",
    );
    if (!this.queue.includes(runId) && !this.active.has(runId)) {
      this.queue.push(runId);
    }
    void this.pump();
    return run;
  }

  async cancelRun(runId: string, reason = "user-canceled"): Promise<AgentRun> {
    const current = await this.store.getRun(runId);
    if (!current) {
      throw new Error(`Agent run ${runId} does not exist`);
    }
    if (current.status === "canceled") {
      return current;
    }
    const queueIndex = this.queue.indexOf(runId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
    }
    this.active.get(runId)?.abort(reason);
    if (this.executor.cancel) {
      await this.executor.cancel(current);
    }
    return transitionAgentRun(this.store, runId, "canceled", reason);
  }

  async duplicateRun(
    runId: string,
    title?: string,
    idempotencyKey = `duplicate:${runId}:${title ?? "default"}`,
  ): Promise<AgentRun> {
    const source = await this.requireRun(runId);
    return this.createRun({
      title: title?.trim() || `${source.title} copy`,
      idempotencyKey,
      prompt: source.prompt,
      model: source.model,
      subagentModel: source.subagentModel,
      permissionMode: source.permissionMode,
      parentRunId: source.parentRunId,
      attachments: source.attachments,
      workspace: {
        location: source.workspace.location,
        repositoryPath: source.workspace.repositoryPath,
        retained: source.workspace.retained,
      },
      metadata: { ...source.metadata, duplicatedFromRunId: source.id },
    });
  }

  async cleanupRun(runId: string): Promise<void> {
    let run = await this.store.getRun(runId);
    if (!run) return;
    if (["queued", "running", "waiting"].includes(run.status)) {
      run = await this.cancelRun(runId, "cleanup-requested");
    }
    const deadline = Date.now() + 5_000;
    while (this.active.has(runId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.active.has(runId)) {
      throw new Error(`Agent run ${runId} did not stop before cleanup`);
    }
    await this.workspaceProvider.cleanup?.(run.workspace);
    await this.store.deleteRun(runId);
  }

  async retainWorktree(
    runId: string,
    retained: boolean,
  ): Promise<AgentWorktreeResult> {
    const run = await this.updateRun(runId, (current) => ({
      ...current,
      workspace: { ...current.workspace, retained },
      updatedAt: this.now().toISOString(),
    }));
    return { run };
  }

  async renameWorktree(
    runId: string,
    branch: string,
  ): Promise<AgentWorktreeResult> {
    if (!this.workspaceProvider.rename) {
      throw new Error("This runtime cannot rename worktree branches");
    }
    const current = await this.requireRun(runId);
    const workspace = await this.workspaceProvider.rename(current, branch);
    const run = await this.updateRun(runId, (value) => ({
      ...value,
      workspace,
      updatedAt: this.now().toISOString(),
    }));
    return { run };
  }

  async exportWorktreePatch(runId: string): Promise<AgentWorktreeResult> {
    if (!this.workspaceProvider.exportPatch) {
      throw new Error("This runtime cannot export worktree patches");
    }
    const run = await this.requireRun(runId);
    return { run, patch: await this.workspaceProvider.exportPatch(run) };
  }

  async mergeWorktree(runId: string): Promise<AgentWorktreeResult> {
    if (!this.workspaceProvider.merge) {
      throw new Error("This runtime cannot merge worktrees");
    }
    const run = await this.requireRun(runId);
    if (["queued", "running", "waiting"].includes(run.status)) {
      throw new Error("Stop the agent before merging its worktree");
    }
    const result = await this.workspaceProvider.merge(run);
    return { run, ...result };
  }

  renameRun(runId: string, title: string): Promise<AgentRun> {
    return this.controls.renameRun(runId, title);
  }

  setRunPermission(
    runId: string,
    permissionMode: AgentRun["permissionMode"],
  ): Promise<AgentRun> {
    return this.controls.setRunPermission(runId, permissionMode);
  }

  setRunPinned(runId: string, pinned: boolean): Promise<AgentRun> {
    return this.controls.setRunPinned(runId, pinned);
  }

  setRunUnread(runId: string, unread: boolean): Promise<AgentRun> {
    return this.controls.setRunUnread(runId, unread);
  }

  async archiveRun(runId: string): Promise<AgentRun> {
    return this.controls.archiveRun(runId);
  }

  async enqueuePrompt(
    runId: string,
    prompt: string,
    behavior: AgentQueueItem["behavior"] = "run-next",
  ): Promise<AgentQueueItem> {
    return this.controls.enqueuePrompt(runId, prompt, behavior);
  }

  listQueue(runId: string): Promise<AgentQueueItem[]> {
    return this.controls.listQueue(runId);
  }

  async updateQueueItem(
    runId: string,
    itemId: string,
    update: Pick<AgentQueueItem, "prompt" | "behavior">,
  ): Promise<AgentQueueItem> {
    return this.controls.updateQueueItem(runId, itemId, update);
  }

  async removeQueueItem(runId: string, itemId: string): Promise<void> {
    return this.controls.removeQueueItem(runId, itemId);
  }

  async reorderQueue(
    runId: string,
    itemIds: string[],
  ): Promise<AgentQueueItem[]> {
    return this.controls.reorderQueue(runId, itemIds);
  }

  async createCheckpoint(
    runId: string,
    label?: string,
  ): Promise<AgentCheckpoint> {
    return this.controls.createCheckpoint(runId, label);
  }

  listCheckpoints(runId: string): Promise<AgentCheckpoint[]> {
    return this.controls.listCheckpoints(runId);
  }

  async restoreCheckpoint(runId: string, checkpointId: string): Promise<void> {
    return this.controls.restoreCheckpoint(runId, checkpointId);
  }

  createPlan(
    runId: string,
    title: string,
    items: string[],
  ): Promise<AgentPlan> {
    return this.controls.createPlan(runId, title, items);
  }

  listPlans(runId: string): Promise<AgentPlan[]> {
    return this.controls.listPlans(runId);
  }

  updatePlan(
    runId: string,
    planId: string,
    update: Pick<AgentPlan, "title" | "items">,
    expectedRevision: number,
  ): Promise<AgentPlan> {
    return this.controls.updatePlan(runId, planId, update, expectedRevision);
  }

  setPlanStatus(
    runId: string,
    planId: string,
    status: AgentPlan["status"],
    expectedRevision: number,
  ): Promise<AgentPlan> {
    return this.controls.setPlanStatus(runId, planId, status, expectedRevision);
  }

  async waitForIdle(): Promise<void> {
    while (this.queue.length > 0 || this.active.size > 0 || this.pumping) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private async updateRun(
    runId: string,
    update: (run: AgentRun) => AgentRun,
  ): Promise<AgentRun> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.store.getRun(runId);
      if (!current) {
        throw new Error(`Agent run ${runId} does not exist`);
      }
      try {
        return await this.store.saveRun(update(current), current.revision);
      } catch (error) {
        if (!(error instanceof AgentStoreConflictError)) {
          throw error;
        }
      }
    }
    throw new AgentStoreConflictError(runId);
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      while (this.active.size < this.maxConcurrency && this.queue.length > 0) {
        const runId = this.queue.shift()!;
        const run = await this.store.getRun(runId);
        if (!run || run.status !== "queued") {
          continue;
        }
        const controller = new AbortController();
        this.active.set(runId, controller);
        void this.executeRun(runId, controller).finally(() => {
          this.active.delete(runId);
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private async executeRun(
    runId: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      let run = await transitionAgentRun(this.store, runId, "running");
      await this.runHooks("agent.before", { run });
      const workspace = await this.workspaceProvider.prepare(run);
      run = await this.updateRun(runId, (current) => ({
        ...current,
        workspace,
        updatedAt: this.now().toISOString(),
      }));
      if (this.autoCheckpoint) {
        await this.controls.createCheckpoint(runId, "Before agent changes");
      }
      while (true) {
        const result = await this.executor.execute(run, {
          signal: controller.signal,
          emit: async (event) => {
            await this.store.appendEvent({
              ...event,
              id: this.idFactory(),
              runId,
            });
          },
        });
        const latest = await this.store.getRun(runId);
        if (!latest || latest.status === "canceled") return;
        if (
          result?.diffAdded !== undefined ||
          result?.diffRemoved !== undefined ||
          result?.metadata
        ) {
          run = await this.updateRun(runId, (current) => ({
            ...current,
            diffAdded:
              result?.diffAdded === undefined
                ? current.diffAdded
                : (current.diffAdded ?? 0) + result.diffAdded,
            diffRemoved:
              result?.diffRemoved === undefined
                ? current.diffRemoved
                : (current.diffRemoved ?? 0) + result.diffRemoved,
            metadata: { ...current.metadata, ...result?.metadata },
            updatedAt: this.now().toISOString(),
          }));
        } else {
          run = latest;
        }

        const resultStatus = result?.status ?? "completed";
        const queue = await this.controls.listQueue(runId);
        if (resultStatus === "completed" && queue.length > 0) {
          const next = queue[0];
          if (this.autoCheckpoint) {
            await this.controls.createCheckpoint(runId, "Before follow-up");
          }
          await this.store.appendEvent({
            id: this.idFactory(),
            runId,
            kind: "message.user",
            createdAt: this.now().toISOString(),
            payload: {
              prompt: next.prompt,
              queueItemId: next.id,
              behavior: next.behavior,
            },
          });
          await this.controls.removeQueueItem(runId, next.id);
          run = {
            ...run,
            prompt: next.prompt,
            metadata: { ...run.metadata, activeQueueItemId: next.id },
          };
          continue;
        }

        const finished = await transitionAgentRun(
          this.store,
          runId,
          resultStatus,
          result?.reason,
        );
        if (["completed", "failed", "attention"].includes(finished.status)) {
          const unread = await this.controls.setRunUnread(runId, true);
          if (this.onRunFinished) {
            try {
              await this.onRunFinished(unread);
            } catch (error) {
              await this.store.appendEvent({
                id: this.idFactory(),
                runId,
                kind: "runtime.notice",
                createdAt: this.now().toISOString(),
                payload: {
                  type: "attribution.capture.failed",
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            }
          }
          await this.runHooks("agent.after", { run: unread });
        }
        break;
      }
    } catch (error) {
      const current = await this.store.getRun(runId);
      if (current && current.status !== "canceled") {
        const message = error instanceof Error ? error.message : String(error);
        if (["completed", "failed", "attention"].includes(current.status)) {
          await this.store.appendEvent({
            id: this.idFactory(),
            runId,
            kind: "runtime.notice",
            createdAt: this.now().toISOString(),
            payload: { type: "terminal-hook.failed", error: message },
          });
        } else {
          await transitionAgentRun(this.store, runId, "failed", message);
        }
      }
    }
  }

  private async requireRun(runId: string): Promise<AgentRun> {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`Agent run ${runId} does not exist`);
    return run;
  }

  private async runHooks(
    event: "agent.before" | "agent.after",
    payload: { run: AgentRun },
  ): Promise<void> {
    if (!this.hooks) return;
    const results = await this.hooks.run(event, payload);
    for (const result of results) {
      await this.store.appendEvent({
        id: this.idFactory(),
        runId: payload.run.id,
        kind: "runtime.notice",
        createdAt: this.now().toISOString(),
        payload: { type: "hook.result", result },
      });
    }
  }
}
