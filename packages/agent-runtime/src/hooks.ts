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
  protocol?: "qivryn" | "codex";
  sourceEvent?:
    | "SessionStart"
    | "UserPromptSubmit"
    | "Stop"
    | "PreToolUse"
    | "PostToolUse";
  matcher?: string;
}

export interface AgentHookResult {
  hookId: string;
  event: AgentHookEvent;
  status: "completed" | "failed" | "timed-out";
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  additionalContext?: string;
  blocked?: boolean;
  blockReason?: string;
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
      if (Array.isArray(value)) return value as AgentHookDefinition[];
      if (value && typeof value === "object" && "hooks" in value) {
        return codexHookDefinitions(
          (value as { hooks?: Record<string, unknown> }).hooks,
        );
      }
      throw new Error(
        "Hook configuration must be an array or a Codex hooks object",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (escaped || quote)
    throw new Error(`Invalid hook command quoting: ${command}`);
  if (current) parts.push(current);
  return parts;
}

function mappedEvent(sourceEvent: string): AgentHookEvent | undefined {
  if (sourceEvent === "SessionStart" || sourceEvent === "UserPromptSubmit") {
    return "agent.before";
  }
  if (sourceEvent === "Stop") return "agent.after";
  if (sourceEvent === "PreToolUse") return "tool.before";
  if (sourceEvent === "PostToolUse") return "tool.after";
  return undefined;
}

function codexHookDefinitions(
  hooks: Record<string, unknown> | undefined,
): AgentHookDefinition[] {
  const definitions: AgentHookDefinition[] = [];
  for (const [sourceEvent, value] of Object.entries(hooks ?? {})) {
    const event = mappedEvent(sourceEvent);
    if (!event || !Array.isArray(value)) continue;
    for (const [groupIndex, groupValue] of value.entries()) {
      if (!groupValue || typeof groupValue !== "object") continue;
      const group = groupValue as {
        matcher?: string;
        hooks?: Array<{
          type?: string;
          command?: string;
          timeout?: number;
          enabled?: boolean;
        }>;
      };
      for (const [hookIndex, handler] of (group.hooks ?? []).entries()) {
        if ((handler.type ?? "command") !== "command" || !handler.command) {
          continue;
        }
        const command = splitCommand(handler.command);
        if (!command[0]) continue;
        definitions.push({
          id: `codex:${sourceEvent}:${groupIndex}:${hookIndex}`,
          event,
          command: command[0],
          args: command.slice(1),
          timeoutMs: Math.max(1, handler.timeout ?? 30) * 1_000,
          failurePolicy: "warn",
          enabled: handler.enabled !== false,
          protocol: "codex",
          sourceEvent: sourceEvent as AgentHookDefinition["sourceEvent"],
          matcher: group.matcher,
        });
      }
    }
  }
  return definitions;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function codexPayload(
  hook: AgentHookDefinition,
  payload: unknown,
): Record<string, unknown> {
  const value = record(payload);
  const run = record(value.run);
  const workspace = record(run.workspace);
  const spec = record(value.spec);
  const common = {
    session_id: typeof run.id === "string" ? run.id : "qivryn-agent",
    transcript_path: "",
    cwd:
      (typeof workspace.worktreePath === "string" && workspace.worktreePath) ||
      (typeof workspace.repositoryPath === "string" &&
        workspace.repositoryPath) ||
      process.cwd(),
    permission_mode:
      typeof run.permissionMode === "string" ? run.permissionMode : undefined,
    hook_event_name: hook.sourceEvent,
  };
  if (hook.sourceEvent === "SessionStart") {
    return { ...common, source: "startup" };
  }
  if (hook.sourceEvent === "UserPromptSubmit") {
    return {
      ...common,
      prompt: typeof run.prompt === "string" ? run.prompt : "",
    };
  }
  if (hook.sourceEvent === "Stop") {
    return { ...common, stop_hook_active: false };
  }
  const command =
    typeof spec.command === "string" ? spec.command : "agent-process";
  return {
    ...common,
    tool_name: command,
    tool_input: spec,
    tool_response: value.result,
    tool_use_id: `${common.session_id}:${command}`,
  };
}

function parseHookOutput(
  stdout: string,
): Pick<AgentHookResult, "additionalContext" | "blocked" | "blockReason"> {
  if (!stdout.trim()) return {};
  try {
    const output = JSON.parse(stdout) as {
      decision?: string;
      reason?: string;
      hookSpecificOutput?: { additionalContext?: string };
    };
    return {
      additionalContext: output.hookSpecificOutput?.additionalContext,
      blocked: output.decision === "block",
      blockReason: output.decision === "block" ? output.reason : undefined,
    };
  } catch {
    return {};
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
        const parsedOutput =
          status === "completed" ? parseHookOutput(stdout) : {};
        resolve({
          hookId: hook.id,
          event,
          status,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          ...parsedOutput,
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
      child.stdin.end(
        `${JSON.stringify(
          hook.protocol === "codex" ? codexPayload(hook, payload) : payload,
        )}\n`,
      );
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
