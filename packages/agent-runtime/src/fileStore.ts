import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  AgentEvent,
  AgentCheckpoint,
  AgentPlan,
  AgentQueueItem,
  AgentRun,
  ListAgentRunsOptions,
  NewAgentEvent,
  ReadAgentEventsOptions,
} from "./contracts.js";
import { AgentStore, AgentStoreConflictError } from "./store.js";

export interface FileAgentStoreOptions {
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

export interface FileAgentRunCreation {
  run: AgentRun;
  created: boolean;
}

export class FileAgentStore implements AgentStore {
  private readonly runsDirectory: string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private readonly eventCache = new Map<string, AgentEvent[]>();

  constructor(
    private readonly rootDirectory: string,
    options: FileAgentStoreOptions = {},
  ) {
    this.runsDirectory = path.join(rootDirectory, "runs");
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
  }

  async initialize(): Promise<void> {
    await mkdir(this.runsDirectory, { recursive: true });
  }

  async createRun(run: AgentRun): Promise<AgentRun> {
    return (await this.createRunAtomic(run)).run;
  }

  async createRunAtomic(run: AgentRun): Promise<FileAgentRunCreation> {
    return this.withLock("store", async () => {
      if (run.idempotencyKey) {
        const idempotent = await this.findRunByIdempotencyKey(
          run.idempotencyKey,
        );
        if (idempotent) {
          return { run: idempotent, created: false };
        }
      }
      const existing = await this.getRun(run.id);
      if (existing) {
        return { run: existing, created: false };
      }
      const directory = this.runDirectory(run.id);
      await mkdir(directory, { recursive: true });
      await this.writeJsonAtomic(path.join(directory, "run.json"), run);
      await writeFile(path.join(directory, "events.ndjson"), "", {
        flag: "a",
      });
      this.eventCache.set(run.id, []);
      await this.writeJsonAtomic(path.join(directory, "queue.json"), []);
      await this.writeJsonAtomic(path.join(directory, "checkpoints.json"), []);
      await this.writeJsonAtomic(path.join(directory, "plans.json"), []);
      return { run: structuredClone(run), created: true };
    });
  }

  async getRun(runId: string): Promise<AgentRun | undefined> {
    try {
      return JSON.parse(
        await readFile(path.join(this.runDirectory(runId), "run.json"), "utf8"),
      ) as AgentRun;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async findRunByIdempotencyKey(key: string): Promise<AgentRun | undefined> {
    const runs = await this.listRuns({
      includeArchived: true,
      limit: Number.MAX_SAFE_INTEGER,
    });
    return runs.find((run) => run.idempotencyKey === key);
  }

  async listRuns(options: ListAgentRunsOptions = {}): Promise<AgentRun[]> {
    await this.initialize();
    const entries = await readdir(this.runsDirectory, { withFileTypes: true });
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return JSON.parse(
              await readFile(
                path.join(this.runsDirectory, entry.name, "run.json"),
                "utf8",
              ),
            ) as AgentRun;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              return undefined;
            }
            throw error;
          }
        }),
    );
    const filtered = runs
      .filter((run): run is AgentRun => !!run)
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
    return options.limit === undefined
      ? filtered
      : filtered.slice(0, options.limit);
  }

  async saveRun(run: AgentRun, expectedRevision: number): Promise<AgentRun> {
    return this.withLock(`run-${run.id}`, async () => {
      const existing = await this.getRun(run.id);
      if (!existing || existing.revision !== expectedRevision) {
        throw new AgentStoreConflictError(run.id);
      }
      const saved = structuredClone({
        ...run,
        revision: expectedRevision + 1,
      });
      await this.writeJsonAtomic(
        path.join(this.runDirectory(run.id), "run.json"),
        saved,
      );
      return saved;
    });
  }

  async deleteRun(runId: string): Promise<void> {
    await this.withLock("store", async () => {
      await rm(this.runDirectory(runId), { recursive: true, force: true });
      this.eventCache.delete(runId);
    });
  }

  async appendEvent<TPayload>(
    event: NewAgentEvent<TPayload>,
  ): Promise<AgentEvent<TPayload>> {
    return this.withLock(`events-${event.runId}`, async () => {
      if (!(await this.getRun(event.runId))) {
        throw new Error(`Agent run ${event.runId} does not exist`);
      }
      const events = await this.readAllEvents(event.runId);
      const duplicate = events.find((candidate) => candidate.id === event.id);
      if (duplicate) {
        return duplicate as AgentEvent<TPayload>;
      }
      const appended: AgentEvent<TPayload> = {
        ...event,
        sequence: (events.at(-1)?.sequence ?? 0) + 1,
      };
      await appendFile(
        path.join(this.runDirectory(event.runId), "events.ndjson"),
        `${JSON.stringify(appended)}\n`,
        "utf8",
      );
      events.push(appended as AgentEvent);
      return appended;
    });
  }

  async readEvents(
    runId: string,
    options: ReadAgentEventsOptions = {},
  ): Promise<AgentEvent[]> {
    const events = await this.readAllEvents(runId);
    return events
      .filter((event) => event.sequence > (options.afterSequence ?? 0))
      .slice(0, options.limit ?? 1_000)
      .map((event) => structuredClone(event));
  }

  private async readAllEvents(runId: string): Promise<AgentEvent[]> {
    const cached = this.eventCache.get(runId);
    if (cached) return cached;
    try {
      const content = await readFile(
        path.join(this.runDirectory(runId), "events.ndjson"),
        "utf8",
      );
      const events = content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AgentEvent);
      this.eventCache.set(runId, events);
      return events;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async listQueue(runId: string): Promise<AgentQueueItem[]> {
    const items = await this.readJsonArray<AgentQueueItem>(
      path.join(this.runDirectory(runId), "queue.json"),
    );
    return items.sort((a, b) => a.position - b.position);
  }

  async saveQueueItem(item: AgentQueueItem): Promise<AgentQueueItem> {
    return this.withLock(`queue-${item.runId}`, async () => {
      const items = await this.listQueue(item.runId);
      const index = items.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) items[index] = item;
      else items.push(item);
      await this.writeJsonAtomic(
        path.join(this.runDirectory(item.runId), "queue.json"),
        items,
      );
      return structuredClone(item);
    });
  }

  async deleteQueueItem(runId: string, itemId: string): Promise<void> {
    await this.withLock(`queue-${runId}`, async () => {
      const items = (await this.listQueue(runId)).filter(
        (item) => item.id !== itemId,
      );
      await this.writeJsonAtomic(
        path.join(this.runDirectory(runId), "queue.json"),
        items,
      );
    });
  }

  async replaceQueue(runId: string, items: AgentQueueItem[]): Promise<void> {
    await this.withLock(`queue-${runId}`, async () => {
      await this.writeJsonAtomic(
        path.join(this.runDirectory(runId), "queue.json"),
        items,
      );
    });
  }

  async getCheckpoint(
    runId: string,
    checkpointId: string,
  ): Promise<AgentCheckpoint | undefined> {
    return (await this.listCheckpoints(runId)).find(
      (checkpoint) => checkpoint.id === checkpointId,
    );
  }

  async listCheckpoints(runId: string): Promise<AgentCheckpoint[]> {
    const checkpoints = await this.readJsonArray<AgentCheckpoint>(
      path.join(this.runDirectory(runId), "checkpoints.json"),
    );
    return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<AgentCheckpoint> {
    return this.withLock(`checkpoints-${checkpoint.runId}`, async () => {
      const checkpoints = await this.listCheckpoints(checkpoint.runId);
      const index = checkpoints.findIndex(
        (candidate) => candidate.id === checkpoint.id,
      );
      if (index >= 0) checkpoints[index] = checkpoint;
      else checkpoints.push(checkpoint);
      await this.writeJsonAtomic(
        path.join(this.runDirectory(checkpoint.runId), "checkpoints.json"),
        checkpoints,
      );
      return structuredClone(checkpoint);
    });
  }

  async listPlans(runId: string): Promise<AgentPlan[]> {
    const plans = await this.readJsonArray<AgentPlan>(
      path.join(this.runDirectory(runId), "plans.json"),
    );
    return plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getPlan(runId: string, planId: string): Promise<AgentPlan | undefined> {
    return (await this.listPlans(runId)).find((plan) => plan.id === planId);
  }

  async savePlan(
    plan: AgentPlan,
    expectedRevision?: number,
  ): Promise<AgentPlan> {
    return this.withLock(`plans-${plan.runId}`, async () => {
      const plans = await this.listPlans(plan.runId);
      const index = plans.findIndex((candidate) => candidate.id === plan.id);
      if (
        expectedRevision !== undefined &&
        (index < 0 || plans[index].revision !== expectedRevision)
      ) {
        throw new AgentStoreConflictError(plan.runId);
      }
      const saved: AgentPlan = {
        ...structuredClone(plan),
        revision:
          expectedRevision === undefined ? plan.revision : expectedRevision + 1,
      };
      if (index >= 0) plans[index] = saved;
      else plans.push(saved);
      await this.writeJsonAtomic(
        path.join(this.runDirectory(plan.runId), "plans.json"),
        plans,
      );
      return structuredClone(saved);
    });
  }

  private runDirectory(runId: string): string {
    return path.join(this.runsDirectory, encodeURIComponent(runId));
  }

  private async writeJsonAtomic(
    filepath: string,
    value: unknown,
  ): Promise<void> {
    const temporaryPath = `${filepath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, filepath);
  }

  private async readJsonArray<T>(filepath: string): Promise<T[]> {
    try {
      return JSON.parse(await readFile(filepath, "utf8")) as T[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async withLock<T>(
    name: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.initialize();
    const lockPath = path.join(
      this.rootDirectory,
      `.${encodeURIComponent(name)}.lock`,
    );
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(String(Date.now()));
          return await operation();
        } finally {
          await handle.close();
          await rm(lockPath, { force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          const lockTimestamp = Number(
            await readFile(lockPath, "utf8").catch(() => "0"),
          );
          if (Date.now() - lockTimestamp > this.staleLockMs) {
            await rm(lockPath, { force: true });
            continue;
          }
          throw new Error(`Timed out acquiring agent store lock: ${name}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
}
