import { randomUUID } from "node:crypto";
import { AgentEventKind, AgentRun, AgentRunStatus } from "./contracts.js";
import { AgentStore, AgentStoreConflictError } from "./store.js";

const ALLOWED_TRANSITIONS: Record<AgentRunStatus, AgentRunStatus[]> = {
  draft: ["queued", "canceled", "archived"],
  queued: ["running", "canceled", "archived"],
  running: ["waiting", "attention", "completed", "failed", "canceled"],
  waiting: ["running", "attention", "failed", "canceled"],
  attention: ["queued", "running", "failed", "canceled", "archived"],
  completed: ["queued", "archived"],
  failed: ["queued", "archived"],
  canceled: ["queued", "archived"],
  archived: [],
};

export function canTransitionAgentRun(
  from: AgentRunStatus,
  to: AgentRunStatus,
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

async function appendStatusEvent(
  store: AgentStore,
  run: AgentRun,
  from: AgentRunStatus,
): Promise<void> {
  await store.appendEvent({
    id: randomUUID(),
    runId: run.id,
    kind: "run.status" satisfies AgentEventKind,
    createdAt: run.updatedAt,
    payload: { from, to: run.status, reason: run.statusReason },
  });
}

export async function transitionAgentRun(
  store: AgentStore,
  runId: string,
  status: AgentRunStatus,
  reason?: string,
): Promise<AgentRun> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.getRun(runId);
    if (!current) {
      throw new Error(`Agent run ${runId} does not exist`);
    }
    if (current.status === status) {
      return current;
    }
    if (!canTransitionAgentRun(current.status, status)) {
      throw new Error(
        `Invalid agent run transition: ${current.status} -> ${status}`,
      );
    }

    const now = new Date().toISOString();
    const next: AgentRun = {
      ...current,
      status,
      statusReason: reason,
      updatedAt: now,
      startedAt:
        status === "running" ? (current.startedAt ?? now) : current.startedAt,
      finishedAt: ["completed", "failed", "canceled"].includes(status)
        ? now
        : current.finishedAt,
      archived: status === "archived" ? true : current.archived,
    };

    try {
      const saved = await store.saveRun(next, current.revision);
      await appendStatusEvent(store, saved, current.status);
      return saved;
    } catch (error) {
      if (!(error instanceof AgentStoreConflictError)) {
        throw error;
      }
    }
  }
  throw new AgentStoreConflictError(runId);
}

export async function recoverInterruptedAgentRuns(
  store: AgentStore,
): Promise<AgentRun[]> {
  const interrupted = await store.listRuns({
    statuses: ["running", "waiting"],
    includeArchived: false,
  });
  return Promise.all(
    interrupted.map((run) =>
      transitionAgentRun(store, run.id, "attention", "runtime-recovered"),
    ),
  );
}
