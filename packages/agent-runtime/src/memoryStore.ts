import {
  AgentEvent,
  AgentCheckpoint,
  AgentQueueItem,
  AgentPlan,
  AgentRun,
  ListAgentRunsOptions,
  NewAgentEvent,
  ReadAgentEventsOptions,
} from "./contracts.js";
import { AgentStore, AgentStoreConflictError } from "./store.js";

export class MemoryAgentStore implements AgentStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly events = new Map<string, AgentEvent[]>();
  private readonly queue = new Map<string, AgentQueueItem[]>();
  private readonly checkpoints = new Map<string, AgentCheckpoint[]>();
  private readonly plans = new Map<string, AgentPlan[]>();

  async initialize(): Promise<void> {}

  async createRun(run: AgentRun): Promise<AgentRun> {
    const existing = this.runs.get(run.id);
    if (existing) {
      return structuredClone(existing);
    }
    this.runs.set(run.id, structuredClone(run));
    return structuredClone(run);
  }

  async getRun(runId: string): Promise<AgentRun | undefined> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async findRunByIdempotencyKey(key: string): Promise<AgentRun | undefined> {
    const run = [...this.runs.values()].find(
      (candidate) => candidate.idempotencyKey === key,
    );
    return run ? structuredClone(run) : undefined;
  }

  async listRuns(options: ListAgentRunsOptions = {}): Promise<AgentRun[]> {
    const runs = [...this.runs.values()]
      .filter((run) => options.includeArchived || !run.archived)
      .filter(
        (run) => !options.statuses || options.statuses.includes(run.status),
      )
      .filter(
        (run) =>
          !options.repositoryPath ||
          run.workspace.repositoryPath === options.repositoryPath,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return runs.slice(0, options.limit).map((run) => structuredClone(run));
  }

  async saveRun(run: AgentRun, expectedRevision: number): Promise<AgentRun> {
    const existing = this.runs.get(run.id);
    if (!existing || existing.revision !== expectedRevision) {
      throw new AgentStoreConflictError(run.id);
    }
    const saved = structuredClone({ ...run, revision: expectedRevision + 1 });
    this.runs.set(run.id, saved);
    return structuredClone(saved);
  }

  async deleteRun(runId: string): Promise<void> {
    this.runs.delete(runId);
    this.events.delete(runId);
    this.queue.delete(runId);
    this.checkpoints.delete(runId);
    this.plans.delete(runId);
  }

  async appendEvent<TPayload>(
    event: NewAgentEvent<TPayload>,
  ): Promise<AgentEvent<TPayload>> {
    const events = this.events.get(event.runId) ?? [];
    const duplicate = events.find((candidate) => candidate.id === event.id);
    if (duplicate) {
      return structuredClone(duplicate) as AgentEvent<TPayload>;
    }
    const appended: AgentEvent<TPayload> = {
      ...structuredClone(event),
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
    };
    events.push(appended as AgentEvent);
    this.events.set(event.runId, events);
    return structuredClone(appended);
  }

  async readEvents(
    runId: string,
    options: ReadAgentEventsOptions = {},
  ): Promise<AgentEvent[]> {
    return (this.events.get(runId) ?? [])
      .filter((event) => event.sequence > (options.afterSequence ?? 0))
      .slice(0, options.limit ?? 1_000)
      .map((event) => structuredClone(event));
  }

  async listQueue(runId: string): Promise<AgentQueueItem[]> {
    return structuredClone(this.queue.get(runId) ?? []).sort(
      (a, b) => a.position - b.position,
    );
  }

  async saveQueueItem(item: AgentQueueItem): Promise<AgentQueueItem> {
    const items = this.queue.get(item.runId) ?? [];
    const index = items.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) items[index] = structuredClone(item);
    else items.push(structuredClone(item));
    this.queue.set(item.runId, items);
    return structuredClone(item);
  }

  async deleteQueueItem(runId: string, itemId: string): Promise<void> {
    this.queue.set(
      runId,
      (this.queue.get(runId) ?? []).filter((item) => item.id !== itemId),
    );
  }

  async replaceQueue(runId: string, items: AgentQueueItem[]): Promise<void> {
    this.queue.set(runId, structuredClone(items));
  }

  async getCheckpoint(
    runId: string,
    checkpointId: string,
  ): Promise<AgentCheckpoint | undefined> {
    const checkpoint = (this.checkpoints.get(runId) ?? []).find(
      (candidate) => candidate.id === checkpointId,
    );
    return checkpoint ? structuredClone(checkpoint) : undefined;
  }

  async listCheckpoints(runId: string): Promise<AgentCheckpoint[]> {
    return structuredClone(this.checkpoints.get(runId) ?? []).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<AgentCheckpoint> {
    const checkpoints = this.checkpoints.get(checkpoint.runId) ?? [];
    const index = checkpoints.findIndex(
      (candidate) => candidate.id === checkpoint.id,
    );
    if (index >= 0) checkpoints[index] = structuredClone(checkpoint);
    else checkpoints.push(structuredClone(checkpoint));
    this.checkpoints.set(checkpoint.runId, checkpoints);
    return structuredClone(checkpoint);
  }

  async listPlans(runId: string): Promise<AgentPlan[]> {
    return structuredClone(this.plans.get(runId) ?? []).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async getPlan(runId: string, planId: string): Promise<AgentPlan | undefined> {
    const plan = (this.plans.get(runId) ?? []).find(
      (candidate) => candidate.id === planId,
    );
    return plan ? structuredClone(plan) : undefined;
  }

  async savePlan(
    plan: AgentPlan,
    expectedRevision?: number,
  ): Promise<AgentPlan> {
    const plans = this.plans.get(plan.runId) ?? [];
    const index = plans.findIndex((candidate) => candidate.id === plan.id);
    if (
      expectedRevision !== undefined &&
      (index < 0 || plans[index].revision !== expectedRevision)
    ) {
      throw new AgentStoreConflictError(plan.runId);
    }
    const saved = structuredClone({
      ...plan,
      revision:
        expectedRevision === undefined ? plan.revision : expectedRevision + 1,
    });
    if (index >= 0) plans[index] = saved;
    else plans.push(saved);
    this.plans.set(plan.runId, plans);
    return structuredClone(saved);
  }
}
