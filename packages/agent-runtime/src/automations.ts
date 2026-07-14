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
  | { type: "interval"; everyMinutes: number }
  | { type: "daily"; at: string }
  | { type: "weekly"; at: string; daysOfWeek: number[] }
  | { type: "rrule"; rrule: string; timezone?: string };

export interface AgentAutomation {
  id: string;
  revision: number;
  name: string;
  prompt: string;
  repositoryPath: string;
  enabled: boolean;
  trigger: AgentAutomationTrigger;
  model?: string;
  reasoningEffort?: string;
  permissionMode: AgentPermissionMode;
  runtimeId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunId?: string;
  nextRunAt?: string;
  metadata?: Record<string, unknown>;
}

export type CreateAgentAutomationRequest = Pick<
  AgentAutomation,
  "name" | "prompt" | "repositoryPath" | "trigger"
> &
  Partial<
    Pick<
      AgentAutomation,
      "enabled" | "model" | "reasoningEffort" | "permissionMode" | "runtimeId"
    >
  >;

export type UpdateAgentAutomationRequest = Partial<
  Pick<
    AgentAutomation,
    | "name"
    | "prompt"
    | "repositoryPath"
    | "trigger"
    | "model"
    | "reasoningEffort"
    | "permissionMode"
    | "runtimeId"
  >
>;

export type AgentAutomationControlRequest =
  | { action: "create"; request: CreateAgentAutomationRequest }
  | {
      action: "update";
      automationId: string;
      request: UpdateAgentAutomationRequest;
    }
  | { action: "run"; automationId: string }
  | { action: "remove"; automationId: string }
  | { action: "enabled"; automationId: string; enabled: boolean };

function parseLocalTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Automation time must use HH:MM format");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error("Automation time must be a valid local time");
  }
  return { hours, minutes };
}

const RRULE_WEEKDAYS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function parseRruleList(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const values = value.split(",").map(Number);
  if (values.some((candidate) => !Number.isInteger(candidate))) {
    throw new Error(`Invalid RRULE numeric list: ${value}`);
  }
  return values;
}

function nextRruleRun(rrule: string, from: Date): string {
  const fields = new Map(
    rrule
      .replace(/^RRULE:/i, "")
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [key.toUpperCase(), value.join("=")];
      }),
  );
  const frequency = fields.get("FREQ")?.toUpperCase();
  if (
    !frequency ||
    !["MINUTELY", "HOURLY", "DAILY", "WEEKLY"].includes(frequency)
  ) {
    throw new Error(
      `Unsupported automation RRULE frequency: ${frequency ?? "missing"}`,
    );
  }
  const interval = Number(fields.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error("Automation RRULE interval must be a positive integer");
  }
  const minutes = parseRruleList(fields.get("BYMINUTE"));
  const hours = parseRruleList(fields.get("BYHOUR"));
  const weekdays = fields
    .get("BYDAY")
    ?.split(",")
    .map((day) => RRULE_WEEKDAYS[day.toUpperCase()]);
  if (weekdays?.some((day) => day === undefined)) {
    throw new Error(`Invalid automation RRULE weekday: ${fields.get("BYDAY")}`);
  }

  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  const maxMinutes = 370 * 24 * 60;
  for (let offset = 0; offset < maxMinutes; offset += 1) {
    const minute = candidate.getMinutes();
    const hour = candidate.getHours();
    const day = candidate.getDay();
    const elapsedMinutes = Math.floor(candidate.getTime() / 60_000);
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const elapsedDays = Math.floor(elapsedHours / 24);
    const elapsedWeeks = Math.floor(elapsedDays / 7);
    const intervalMatches =
      frequency === "MINUTELY"
        ? elapsedMinutes % interval === 0
        : frequency === "HOURLY"
          ? elapsedHours % interval === 0
          : frequency === "DAILY"
            ? elapsedDays % interval === 0
            : elapsedWeeks % interval === 0;
    if (
      intervalMatches &&
      (!minutes || minutes.includes(minute)) &&
      (!hours || hours.includes(hour)) &&
      (!weekdays || weekdays.includes(day))
    ) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new Error("Unable to calculate the next RRULE automation run");
}

export function nextAgentAutomationRun(
  trigger: AgentAutomationTrigger,
  from: Date,
): string | undefined {
  if (trigger.type === "manual") return undefined;
  if (trigger.type === "interval") {
    if (!Number.isFinite(trigger.everyMinutes) || trigger.everyMinutes <= 0) {
      throw new Error("Automation interval must be greater than zero minutes");
    }
    return new Date(
      from.getTime() + trigger.everyMinutes * 60_000,
    ).toISOString();
  }
  if (trigger.type === "rrule") {
    return nextRruleRun(trigger.rrule, from);
  }

  const { hours, minutes } = parseLocalTime(trigger.at);
  const days =
    trigger.type === "daily"
      ? undefined
      : new Set(
          trigger.daysOfWeek.map((day) => {
            if (!Number.isInteger(day) || day < 0 || day > 6) {
              throw new Error(
                "Automation weekdays must be integers between 0 and 6",
              );
            }
            return day;
          }),
        );
  if (days?.size === 0) {
    throw new Error("A weekly automation needs at least one weekday");
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + offset,
      hours,
      minutes,
      0,
      0,
    );
    if (candidate.getTime() <= from.getTime()) continue;
    if (days && !days.has(candidate.getDay())) continue;
    return candidate.toISOString();
  }

  throw new Error("Unable to calculate the next automation run");
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
      reasoningEffort: request.reasoningEffort,
      permissionMode: request.permissionMode ?? "autonomous",
      runtimeId: request.runtimeId ?? "local",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt:
        request.enabled === false
          ? undefined
          : nextAgentAutomationRun(request.trigger, now),
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
      nextRunAt: enabled
        ? nextAgentAutomationRun(current.trigger, new Date())
        : undefined,
    }));
  }

  async updateAutomation(
    id: string,
    request: UpdateAgentAutomationRequest,
  ): Promise<AgentAutomation> {
    return this.update(id, (current) => {
      const next = {
        ...current,
        ...request,
        name: request.name?.trim() ?? current.name,
        prompt: request.prompt?.trim() ?? current.prompt,
        repositoryPath: request.repositoryPath
          ? path.resolve(request.repositoryPath)
          : current.repositoryPath,
      };
      if (!next.name || !next.prompt) {
        throw new Error("Automation name and prompt are required");
      }
      return {
        ...next,
        nextRunAt: next.enabled
          ? nextAgentAutomationRun(next.trigger, new Date())
          : undefined,
      };
    });
  }

  async markRun(id: string, run: AgentRun): Promise<AgentAutomation> {
    return this.update(id, (current) => ({
      ...current,
      lastRunAt: new Date().toISOString(),
      lastRunId: run.id,
      nextRunAt: current.enabled
        ? nextAgentAutomationRun(current.trigger, new Date())
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
    metadata: {
      automationId: automation.id,
      ...(automation.reasoningEffort
        ? { reasoningEffort: automation.reasoningEffort }
        : {}),
    },
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
