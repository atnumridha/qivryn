import {
  AgentEvent,
  AgentPlan,
  AgentCheckpoint,
  AgentQueueItem,
  AgentRun,
  AgentRunId,
  ListAgentRunsOptions,
  NewAgentEvent,
  ReadAgentEventsOptions,
} from "./contracts.js";

export class AgentStoreConflictError extends Error {
  constructor(runId: string) {
    super(`Agent run ${runId} was updated by another process`);
    this.name = "AgentStoreConflictError";
  }
}

export interface AgentStore {
  initialize(): Promise<void>;
  createRun(run: AgentRun): Promise<AgentRun>;
  getRun(runId: AgentRunId): Promise<AgentRun | undefined>;
  findRunByIdempotencyKey(key: string): Promise<AgentRun | undefined>;
  listRuns(options?: ListAgentRunsOptions): Promise<AgentRun[]>;
  saveRun(run: AgentRun, expectedRevision: number): Promise<AgentRun>;
  deleteRun(runId: AgentRunId): Promise<void>;
  appendEvent<TPayload>(
    event: NewAgentEvent<TPayload>,
  ): Promise<AgentEvent<TPayload>>;
  readEvents(
    runId: AgentRunId,
    options?: ReadAgentEventsOptions,
  ): Promise<AgentEvent[]>;
  listQueue(runId: AgentRunId): Promise<AgentQueueItem[]>;
  saveQueueItem(item: AgentQueueItem): Promise<AgentQueueItem>;
  deleteQueueItem(runId: AgentRunId, itemId: string): Promise<void>;
  replaceQueue(runId: AgentRunId, items: AgentQueueItem[]): Promise<void>;
  getCheckpoint(
    runId: AgentRunId,
    checkpointId: string,
  ): Promise<AgentCheckpoint | undefined>;
  listCheckpoints(runId: AgentRunId): Promise<AgentCheckpoint[]>;
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<AgentCheckpoint>;
  listPlans(runId: AgentRunId): Promise<AgentPlan[]>;
  getPlan(runId: AgentRunId, planId: string): Promise<AgentPlan | undefined>;
  savePlan(plan: AgentPlan, expectedRevision?: number): Promise<AgentPlan>;
}
