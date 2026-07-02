import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export type AgentHookEvent =
  | "agent.before"
  | "agent.after"
  | "tool.before"
  | "tool.after"
  | "edit.before"
  | "edit.after"
  | "commit.before"
  | "commit.after"
  | "review.before"
  | "review.after";

export interface AgentHookDefinition {
  id: string;
  event: AgentHookEvent;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  failurePolicy?: "warn" | "error";
  enabled?: boolean;
}

export interface AgentHookResult {
  hookId: string;
  event: AgentHookEvent;
  status: "completed" | "failed" | "timed-out";
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AgentHookExecutor {
  run(event: AgentHookEvent, payload: unknown): Promise<AgentHookResult[]>;
}

export class AgentHookError extends Error {
  constructor(
    message: string,
    readonly result: AgentHookResult,
  ) {
    super(message);
  }
}

export class FileAgentHookRegistry {
  constructor(private readonly filepath: string) {}

  async list(): Promise<AgentHookDefinition[]> {
    try {
      const value = JSON.parse(await readFile(this.filepath, "utf8"));
      if (!Array.isArray(value))
        throw new Error("Hook configuration must be an array");
      return value as AgentHookDefinition[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

export class AgentHookRunner implements AgentHookExecutor {
  constructor(private readonly hooks: () => Promise<AgentHookDefinition[]>) {}

  async run(
    event: AgentHookEvent,
    payload: unknown,
  ): Promise<AgentHookResult[]> {
    const hooks = (await this.hooks()).filter(
      (hook) => hook.event === event && hook.enabled !== false,
    );
    const results: AgentHookResult[] = [];
    for (const hook of hooks) {
      const result = await this.execute(hook, event, payload);
      results.push(result);
      if (
        result.status !== "completed" &&
        (hook.failurePolicy ?? "warn") === "error"
      ) {
        throw new AgentHookError(`Hook ${hook.id} ${result.status}`, result);
      }
    }
    return results;
  }

  private execute(
    hook: AgentHookDefinition,
    event: AgentHookEvent,
    payload: unknown,
  ): Promise<AgentHookResult> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const child = spawn(hook.command, hook.args ?? [], {
        cwd: hook.cwd,
        env: { ...process.env, QIVRYN_HOOK_EVENT: event },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (
        status: AgentHookResult["status"],
        exitCode?: number | null,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          hookId: hook.id,
          event,
          status,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      };
      child.stdout.on(
        "data",
        (chunk: Buffer) => (stdout += chunk.toString("utf8")),
      );
      child.stderr.on(
        "data",
        (chunk: Buffer) => (stderr += chunk.toString("utf8")),
      );
      child.once("error", (error) => {
        stderr += error.message;
        finish("failed");
      });
      child.once("exit", (code) =>
        finish(code === 0 ? "completed" : "failed", code),
      );
      child.stdin.end(`${JSON.stringify(payload)}\n`);
      timer = setTimeout(
        () => {
          child.kill("SIGTERM");
          finish("timed-out");
        },
        Math.max(100, hook.timeoutMs ?? 30_000),
      );
      timer.unref();
    });
  }
}
