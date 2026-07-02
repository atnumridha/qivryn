import { randomUUID } from "node:crypto";
import {
  AgentCheckpoint,
  AgentEventKind,
  AgentPermissionMode,
  AgentPlan,
  AgentPlanItem,
  AgentQueueItem,
  AgentRun,
} from "./contracts.js";
import { transitionAgentRun } from "./lifecycle.js";
import { AgentStore, AgentStoreConflictError } from "./store.js";

export interface AgentControlServiceOptions {
  idFactory?: () => string;
  now?: () => Date;
  cancelRun?: (runId: string, reason: string) => Promise<AgentRun>;
  createCheckpoint?: (
    run: AgentRun,
    checkpoint: AgentCheckpoint,
  ) => Promise<Partial<AgentCheckpoint> | void>;
  restoreCheckpoint?: (
    run: AgentRun,
    checkpoint: AgentCheckpoint,
  ) => Promise<void>;
}

export class AgentControlService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly store: AgentStore,
    private readonly options: AgentControlServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  renameRun(runId: string, title: string): Promise<AgentRun> {
    const normalized = title.trim();
    if (!normalized) throw new Error("Agent title cannot be empty");
    return this.updateRun(runId, (run) => ({ ...run, title: normalized }));
  }

  setRunPermission(
    runId: string,
    permissionMode: AgentPermissionMode,
  ): Promise<AgentRun> {
    return this.updateRun(runId, (run) => ({ ...run, permissionMode }));
  }

  setRunPinned(runId: string, pinned: boolean): Promise<AgentRun> {
    return this.updateRun(runId, (run) => ({ ...run, pinned }));
  }

  setRunUnread(runId: string, unread: boolean): Promise<AgentRun> {
    return this.updateRun(runId, (run) => ({ ...run, unread }));
  }

  async archiveRun(runId: string): Promise<AgentRun> {
    let current = await this.requireRun(runId);
    if (current.status === "archived") return current;
    if (["queued", "running", "waiting"].includes(current.status)) {
      if (this.options.cancelRun) {
        current = await this.options.cancelRun(runId, "archived-by-user");
      } else {
        current = await transitionAgentRun(
          this.store,
          runId,
          "canceled",
          "archived-by-user",
        );
      }
    }
    return transitionAgentRun(this.store, current.id, "archived");
  }

  async enqueuePrompt(
    runId: string,
    prompt: string,
    behavior: AgentQueueItem["behavior"] = "run-next",
  ): Promise<AgentQueueItem> {
    await this.requireRun(runId);
    const normalized = prompt.trim();
    if (!normalized) throw new Error("Queued prompt cannot be empty");
    const queue = await this.store.listQueue(runId);
    const saved = await this.store.saveQueueItem({
      id: this.idFactory(),
      runId,
      prompt: normalized,
      position: queue.length,
      createdAt: this.now().toISOString(),
      behavior,
    });
    await this.appendEvent(runId, "queue.added", saved);
    return saved;
  }

  listQueue(runId: string): Promise<AgentQueueItem[]> {
    return this.store.listQueue(runId);
  }

  async updateQueueItem(
    runId: string,
    itemId: string,
    update: Pick<AgentQueueItem, "prompt" | "behavior">,
  ): Promise<AgentQueueItem> {
    const current = (await this.store.listQueue(runId)).find(
      (item) => item.id === itemId,
    );
    if (!current) throw new Error(`Queue item ${itemId} does not exist`);
    const prompt = update.prompt.trim();
    if (!prompt) throw new Error("Queued prompt cannot be empty");
    const saved = await this.store.saveQueueItem({
      ...current,
      prompt,
      behavior: update.behavior,
    });
    await this.appendEvent(runId, "queue.updated", saved);
    return saved;
  }

  async removeQueueItem(runId: string, itemId: string): Promise<void> {
    const queue = await this.store.listQueue(runId);
    if (!queue.some((item) => item.id === itemId)) return;
    await this.store.deleteQueueItem(runId, itemId);
    await this.store.replaceQueue(
      runId,
      (await this.store.listQueue(runId)).map((item, position) => ({
        ...item,
        position,
      })),
    );
    await this.appendEvent(runId, "queue.removed", { itemId });
  }

  async reorderQueue(
    runId: string,
    itemIds: string[],
  ): Promise<AgentQueueItem[]> {
    const queue = await this.store.listQueue(runId);
    if (
      queue.length !== itemIds.length ||
      new Set(itemIds).size !== itemIds.length ||
      itemIds.some((id) => !queue.some((item) => item.id === id))
    ) {
      throw new Error(
        "Queue reorder must contain every queue item exactly once",
      );
    }
    const byId = new Map(queue.map((item) => [item.id, item]));
    const reordered = itemIds.map((id, position) => ({
      ...byId.get(id)!,
      position,
    }));
    await this.store.replaceQueue(runId, reordered);
    await this.appendEvent(runId, "queue.updated", { itemIds });
    return reordered;
  }

  async createCheckpoint(
    runId: string,
    label?: string,
  ): Promise<AgentCheckpoint> {
    const run = await this.requireRun(runId);
    let checkpoint: AgentCheckpoint = {
      id: this.idFactory(),
      runId,
      createdAt: this.now().toISOString(),
      label: label?.trim() || undefined,
      baseRevision: run.workspace.baseRevision,
    };
    const created = await this.options.createCheckpoint?.(run, checkpoint);
    checkpoint = { ...checkpoint, ...created, id: checkpoint.id, runId };
    const saved = await this.store.saveCheckpoint(checkpoint);
    await this.appendEvent(runId, "checkpoint.created", saved);
    return saved;
  }

  listCheckpoints(runId: string): Promise<AgentCheckpoint[]> {
    return this.store.listCheckpoints(runId);
  }

  async restoreCheckpoint(runId: string, checkpointId: string): Promise<void> {
    const run = await this.requireRun(runId);
    const checkpoint = await this.store.getCheckpoint(runId, checkpointId);
    if (!checkpoint)
      throw new Error(`Checkpoint ${checkpointId} does not exist`);
    if (!this.options.restoreCheckpoint) {
      throw new Error("This runtime cannot restore checkpoints");
    }
    await this.options.restoreCheckpoint(run, checkpoint);
    await this.appendEvent(runId, "checkpoint.restored", { checkpointId });
  }

  async createPlan(
    runId: string,
    title: string,
    items: string[],
  ): Promise<AgentPlan> {
    await this.requireRun(runId);
    const normalizedTitle = title.trim();
    const normalizedItems = items.map((item) => item.trim()).filter(Boolean);
    if (!normalizedTitle) throw new Error("Plan title cannot be empty");
    if (normalizedItems.length === 0)
      throw new Error("Plan needs at least one item");
    const now = this.now().toISOString();
    const plan = await this.store.savePlan({
      id: this.idFactory(),
      runId,
      revision: 0,
      title: normalizedTitle,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      items: normalizedItems.map((text) => ({
        id: this.idFactory(),
        text,
        status: "pending",
      })),
    });
    await this.appendEvent(runId, "plan.created", plan);
    return plan;
  }

  listPlans(runId: string): Promise<AgentPlan[]> {
    return this.store.listPlans(runId);
  }

  async updatePlan(
    runId: string,
    planId: string,
    update: Pick<AgentPlan, "title" | "items">,
    expectedRevision: number,
  ): Promise<AgentPlan> {
    const current = await this.store.getPlan(runId, planId);
    if (!current) throw new Error(`Plan ${planId} does not exist`);
    const title = update.title.trim();
    const items = update.items
      .map((item): AgentPlanItem => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text);
    if (!title || items.length === 0)
      throw new Error("Plan title and items are required");
    const saved = await this.store.savePlan(
      { ...current, title, items, updatedAt: this.now().toISOString() },
      expectedRevision,
    );
    await this.appendEvent(runId, "plan.updated", saved);
    return saved;
  }

  async setPlanStatus(
    runId: string,
    planId: string,
    status: AgentPlan["status"],
    expectedRevision: number,
  ): Promise<AgentPlan> {
    const current = await this.store.getPlan(runId, planId);
    if (!current) throw new Error(`Plan ${planId} does not exist`);
    const saved = await this.store.savePlan(
      { ...current, status, updatedAt: this.now().toISOString() },
      expectedRevision,
    );
    await this.appendEvent(runId, "plan.updated", saved);
    return saved;
  }

  private async requireRun(runId: string): Promise<AgentRun> {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`Agent run ${runId} does not exist`);
    return run;
  }

  private async updateRun(
    runId: string,
    update: (run: AgentRun) => AgentRun,
  ): Promise<AgentRun> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.requireRun(runId);
      try {
        return await this.store.saveRun(
          { ...update(current), updatedAt: this.now().toISOString() },
          current.revision,
        );
      } catch (error) {
        if (!(error instanceof AgentStoreConflictError)) throw error;
      }
    }
    throw new AgentStoreConflictError(runId);
  }

  private async appendEvent(
    runId: string,
    kind: AgentEventKind,
    payload: unknown,
  ): Promise<void> {
    await this.store.appendEvent({
      id: this.idFactory(),
      runId,
      kind,
      createdAt: this.now().toISOString(),
      payload,
    });
  }
}
