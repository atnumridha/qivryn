import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentPermissionMode,
  AgentRun,
  AgentRuntimeAdapter,
} from "./contracts.js";

export type AgentAutomationTrigger =
  | { type: "manual" }
  | { type: "interval"; everyMinutes: number };

export interface AgentAutomation {
  id: string;
  revision: number;
  name: string;
  prompt: string;
  repositoryPath: string;
  enabled: boolean;
  trigger: AgentAutomationTrigger;
  model?: string;
  permissionMode: AgentPermissionMode;
  runtimeId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunId?: string;
  nextRunAt?: string;
}

export type CreateAgentAutomationRequest = Pick<
  AgentAutomation,
  "name" | "prompt" | "repositoryPath" | "trigger"
> &
  Partial<
    Pick<AgentAutomation, "enabled" | "model" | "permissionMode" | "runtimeId">
  >;

export type AgentAutomationControlRequest =
  | { action: "create"; request: CreateAgentAutomationRequest }
  | { action: "run"; automationId: string }
  | { action: "remove"; automationId: string }
  | { action: "enabled"; automationId: string; enabled: boolean };

function nextRun(
  trigger: AgentAutomationTrigger,
  from: Date,
): string | undefined {
  if (trigger.type !== "interval") return undefined;
  if (!Number.isFinite(trigger.everyMinutes) || trigger.everyMinutes <= 0) {
    throw new Error("Automation interval must be greater than zero minutes");
  }
  return new Date(from.getTime() + trigger.everyMinutes * 60_000).toISOString();
}

export class FileAgentAutomationStore {
  private readonly filepath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(rootDirectory: string) {
    this.filepath = path.join(rootDirectory, "automations.json");
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filepath), { recursive: true });
  }

  async list(): Promise<AgentAutomation[]> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filepath, "utf8"),
      ) as AgentAutomation[];
      return parsed.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(id: string): Promise<AgentAutomation | undefined> {
    return (await this.list()).find((automation) => automation.id === id);
  }

  async create(
    request: CreateAgentAutomationRequest,
  ): Promise<AgentAutomation> {
    const now = new Date();
    const automation: AgentAutomation = {
      id: randomUUID(),
      revision: 1,
      name: request.name.trim(),
      prompt: request.prompt.trim(),
      repositoryPath: path.resolve(request.repositoryPath),
      enabled: request.enabled ?? true,
      trigger: request.trigger,
      model: request.model,
      permissionMode: request.permissionMode ?? "autonomous",
      runtimeId: request.runtimeId ?? "local",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt:
        request.enabled === false ? undefined : nextRun(request.trigger, now),
    };
    if (!automation.name || !automation.prompt) {
      throw new Error("Automation name and prompt are required");
    }
    await this.mutate((items) => [...items, automation]);
    return automation;
  }

  async setEnabled(id: string, enabled: boolean): Promise<AgentAutomation> {
    return this.update(id, (current) => ({
      ...current,
      enabled,
      nextRunAt: enabled ? nextRun(current.trigger, new Date()) : undefined,
    }));
  }

  async markRun(id: string, run: AgentRun): Promise<AgentAutomation> {
    return this.update(id, (current) => ({
      ...current,
      lastRunAt: new Date().toISOString(),
      lastRunId: run.id,
      nextRunAt: current.enabled
        ? nextRun(current.trigger, new Date())
        : undefined,
    }));
  }

  async remove(id: string): Promise<void> {
    let found = false;
    await this.mutate((items) =>
      items.filter((item) => {
        if (item.id === id) found = true;
        return item.id !== id;
      }),
    );
    if (!found) throw new Error(`Automation ${id} was not found`);
  }

  async due(now = new Date()): Promise<AgentAutomation[]> {
    return (await this.list()).filter(
      (item) =>
        item.enabled &&
        item.nextRunAt &&
        Date.parse(item.nextRunAt) <= now.getTime(),
    );
  }

  private async update(
    id: string,
    mutate: (automation: AgentAutomation) => AgentAutomation,
  ): Promise<AgentAutomation> {
    let updated: AgentAutomation | undefined;
    await this.mutate((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const next = mutate(item);
        updated = {
          ...next,
          revision: item.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        return updated;
      }),
    );
    if (!updated) throw new Error(`Automation ${id} was not found`);
    return updated;
  }

  private async mutate(
    mutate: (items: AgentAutomation[]) => AgentAutomation[],
  ): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const next = mutate(await this.list());
      const temporary = `${this.filepath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(temporary, this.filepath);
    });
    return this.writeChain;
  }
}

export async function runAgentAutomation(
  automation: AgentAutomation,
  runtime: AgentRuntimeAdapter,
): Promise<AgentRun> {
  return runtime.createRun({
    title: automation.name,
    prompt: automation.prompt,
    model: automation.model,
    permissionMode: automation.permissionMode,
    runtimeId: automation.runtimeId,
    workspace: {
      location: automation.runtimeId === "docker" ? "container" : "local",
      repositoryPath: automation.repositoryPath,
    },
    metadata: { automationId: automation.id },
    idempotencyKey: `automation:${automation.id}:${automation.nextRunAt ?? Date.now()}`,
  });
}

export function startAgentAutomationScheduler(
  store: FileAgentAutomationStore,
  runtime: AgentRuntimeAdapter,
  intervalMs = 15_000,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const automation of await store.due()) {
        const run = await runAgentAutomation(automation, runtime);
        await store.markRun(automation.id, run);
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(
    () => void tick().catch(() => undefined),
    intervalMs,
  );
  timer.unref?.();
  void tick().catch(() => undefined);
  return () => clearInterval(timer);
}
