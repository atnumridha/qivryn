import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  applyHostSandbox,
  type HostSandboxMetadata,
  type HostSandboxPolicy,
  type HostSandboxResolver,
} from "./hostSandbox.js";
import type { AgentProcessCommand } from "./processExecutor.js";

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
  /** Allows reviewed hooks to run when a requested host sandbox is unavailable. */
  trusted?: boolean;
}

export interface AgentHookResult {
  hookId: string;
  event: AgentHookEvent;
  status: "completed" | "failed" | "timed-out" | "skipped";
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  additionalContext?: string;
  blocked?: boolean;
  blockReason?: string;
  sandbox?: HostSandboxMetadata;
  trustedUnsandboxed?: boolean;
}

export interface AgentHookExecutor {
  run(event: AgentHookEvent, payload: unknown): Promise<AgentHookResult[]>;
}

const AGENT_HOOK_EVENTS = new Set<string>([
  "agent.before",
  "agent.after",
  "tool.before",
  "tool.after",
  "edit.before",
  "edit.after",
  "commit.before",
  "commit.after",
  "review.before",
  "review.after",
]);

const CODEX_HOOK_EVENTS = new Set<string>([
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "PreToolUse",
  "PostToolUse",
]);

function validateHookDefinitions(value: unknown): AgentHookDefinition[] {
  if (!Array.isArray(value))
    throw new Error("Hook registry must return an array");
  return value.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`Hook configuration entry ${index} must be an object`);
    }
    const hook = candidate as Record<string, unknown>;
    if (typeof hook.id !== "string" || !hook.id.trim()) {
      throw new Error(
        `Hook configuration entry ${index}.id must be a non-empty string`,
      );
    }
    if (typeof hook.event !== "string" || !AGENT_HOOK_EVENTS.has(hook.event)) {
      throw new Error(`Hook configuration entry ${index}.event is invalid`);
    }
    if (typeof hook.command !== "string" || !hook.command.trim()) {
      throw new Error(
        `Hook configuration entry ${index}.command must be a non-empty string`,
      );
    }
    if (
      hook.args !== undefined &&
      (!Array.isArray(hook.args) ||
        hook.args.some((argument) => typeof argument !== "string"))
    ) {
      throw new Error(
        `Hook configuration entry ${index}.args must be an array of strings`,
      );
    }
    if (hook.cwd !== undefined && typeof hook.cwd !== "string") {
      throw new Error(`Hook configuration entry ${index}.cwd must be a string`);
    }
    if (
      hook.timeoutMs !== undefined &&
      (typeof hook.timeoutMs !== "number" ||
        !Number.isFinite(hook.timeoutMs) ||
        hook.timeoutMs < 0)
    ) {
      throw new Error(
        `Hook configuration entry ${index}.timeoutMs must be a non-negative number`,
      );
    }
    if (
      hook.failurePolicy !== undefined &&
      hook.failurePolicy !== "warn" &&
      hook.failurePolicy !== "error"
    ) {
      throw new Error(
        `Hook configuration entry ${index}.failurePolicy is invalid`,
      );
    }
    if (hook.enabled !== undefined && typeof hook.enabled !== "boolean") {
      throw new Error(
        `Hook configuration entry ${index}.enabled must be boolean`,
      );
    }
    if (
      hook.protocol !== undefined &&
      hook.protocol !== "qivryn" &&
      hook.protocol !== "codex"
    ) {
      throw new Error(`Hook configuration entry ${index}.protocol is invalid`);
    }
    if (
      hook.sourceEvent !== undefined &&
      (typeof hook.sourceEvent !== "string" ||
        !CODEX_HOOK_EVENTS.has(hook.sourceEvent))
    ) {
      throw new Error(
        `Hook configuration entry ${index}.sourceEvent is invalid`,
      );
    }
    if (hook.matcher !== undefined && typeof hook.matcher !== "string") {
      throw new Error(
        `Hook configuration entry ${index}.matcher must be a string`,
      );
    }
    if (hook.trusted !== undefined && typeof hook.trusted !== "boolean") {
      throw new Error(
        `Hook configuration entry ${index}.trusted must be boolean`,
      );
    }
    return candidate as unknown as AgentHookDefinition;
  });
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
      const value: unknown = JSON.parse(await readFile(this.filepath, "utf8"));
      if (Array.isArray(value)) return validateHookDefinitions(value);
      if (value && typeof value === "object") {
        const eventMap =
          "hooks" in value
            ? (value as { hooks?: unknown }).hooks
            : (value as Record<string, unknown>);
        if (
          !eventMap ||
          typeof eventMap !== "object" ||
          Array.isArray(eventMap)
        ) {
          throw new Error("Codex hooks must be an event-map object");
        }
        return validateHookDefinitions(
          codexHookDefinitions(eventMap as Record<string, unknown>),
        );
      }
      throw new Error(
        "Hook configuration must be an array, a Codex hooks object, or a Codex event map",
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
  const input = command.trim();
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === "\\" && quote !== "'") {
      const next = input[index + 1];
      if (quote === '"') {
        if (next === '"') {
          current += next;
          index++;
        } else {
          current += character;
        }
        continue;
      }
      if (next && (/\s/.test(next) || next === "'" || next === '"')) {
        current += next;
        index++;
      } else {
        current += character;
      }
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
  if (quote) throw new Error(`Invalid hook command quoting: ${command}`);
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
  hooks: Record<string, unknown>,
): AgentHookDefinition[] {
  const definitions: AgentHookDefinition[] = [];
  for (const [sourceEvent, value] of Object.entries(hooks)) {
    const event = mappedEvent(sourceEvent);
    if (!event) continue;
    if (!Array.isArray(value)) {
      throw new Error(`Codex hook event ${sourceEvent} must be an array`);
    }
    for (const [groupIndex, groupValue] of value.entries()) {
      if (
        !groupValue ||
        typeof groupValue !== "object" ||
        Array.isArray(groupValue)
      ) {
        throw new Error(
          `Codex hook event ${sourceEvent}[${groupIndex}] must be an object`,
        );
      }
      const group = groupValue as {
        matcher?: unknown;
        hooks?: unknown;
      };
      if (group.matcher !== undefined && typeof group.matcher !== "string") {
        throw new Error(
          `Codex hook event ${sourceEvent}[${groupIndex}].matcher must be a string`,
        );
      }
      if (group.hooks !== undefined && !Array.isArray(group.hooks)) {
        throw new Error(
          `Codex hook event ${sourceEvent}[${groupIndex}].hooks must be an array`,
        );
      }
      for (const [hookIndex, handlerValue] of (group.hooks ?? []).entries()) {
        if (
          !handlerValue ||
          typeof handlerValue !== "object" ||
          Array.isArray(handlerValue)
        ) {
          throw new Error(
            `Codex hook event ${sourceEvent}[${groupIndex}].hooks[${hookIndex}] must be an object`,
          );
        }
        const handler = handlerValue as {
          type?: unknown;
          command?: unknown;
          timeout?: unknown;
          enabled?: unknown;
          trusted?: unknown;
        };
        if (handler.type !== undefined && typeof handler.type !== "string") {
          throw new Error(
            `Codex hook event ${sourceEvent}[${groupIndex}].hooks[${hookIndex}].type must be a string`,
          );
        }
        if ((handler.type ?? "command") !== "command") {
          continue;
        }
        if (typeof handler.command !== "string" || !handler.command.trim()) {
          throw new Error(
            `Codex hook event ${sourceEvent}[${groupIndex}].hooks[${hookIndex}].command must be a non-empty string`,
          );
        }
        const command = splitCommand(handler.command);
        if (!command[0]) {
          throw new Error(
            `Codex hook event ${sourceEvent}[${groupIndex}].hooks[${hookIndex}].command must not be empty`,
          );
        }
        if (
          handler.timeout !== undefined &&
          (typeof handler.timeout !== "number" ||
            !Number.isFinite(handler.timeout) ||
            handler.timeout < 0)
        ) {
          throw new Error(
            `Codex hook event ${sourceEvent}[${groupIndex}].hooks[${hookIndex}].timeout must be a non-negative number`,
          );
        }
        if (
          handler.enabled !== undefined &&
          typeof handler.enabled !== "boolean"
        ) {
          throw new Error(
            `Codex hook event ${sourceEvent}[${groupIndex}].hooks[${hookIndex}].enabled must be boolean`,
          );
        }
        if (
          handler.trusted !== undefined &&
          typeof handler.trusted !== "boolean"
        ) {
          throw new Error(
            `Codex hook event ${sourceEvent}[${groupIndex}].hooks[${hookIndex}].trusted must be boolean`,
          );
        }
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
          trusted: handler.trusted === true,
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

function hostSandboxPolicyFromPayload(
  payload: unknown,
): HostSandboxPolicy | undefined {
  const value = record(payload);
  const run = record(value.run);
  const spec = record(value.spec);
  const configured = record(spec.hostSandbox);
  if (
    configured.filesystem === "read-only" &&
    (configured.network === "allow" || configured.network === "deny")
  ) {
    return {
      filesystem: configured.filesystem,
      network: configured.network,
      ...(typeof configured.required === "boolean"
        ? { required: configured.required }
        : {}),
    };
  }
  if (run.permissionMode === "readOnly") {
    return { filesystem: "read-only", network: "allow" };
  }
  return undefined;
}

function hookWorkingDirectory(payload: unknown): string | undefined {
  const run = record(record(payload).run);
  const workspace = record(run.workspace);
  return (
    (typeof workspace.worktreePath === "string" && workspace.worktreePath) ||
    (typeof workspace.repositoryPath === "string" &&
      workspace.repositoryPath) ||
    undefined
  );
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
  hook: AgentHookDefinition,
  stdout: string,
  stderr: string,
  exitCode: number | null | undefined,
): Pick<AgentHookResult, "additionalContext" | "blocked" | "blockReason"> {
  let output:
    | {
        decision?: string;
        reason?: string;
        hookSpecificOutput?: {
          additionalContext?: string;
          hookEventName?: string;
          permissionDecision?: string;
          permissionDecisionReason?: string;
        };
      }
    | undefined;
  try {
    if (stdout.trim()) output = JSON.parse(stdout);
  } catch {
    // Plain stdout remains available on the result for diagnostics.
  }
  const specific = output?.hookSpecificOutput;
  const deniedTool =
    hook.protocol === "codex" &&
    hook.sourceEvent === "PreToolUse" &&
    specific?.hookEventName === "PreToolUse" &&
    specific.permissionDecision === "deny";
  const blockedByExit = hook.protocol === "codex" && exitCode === 2;
  const blockedByDecision = output?.decision === "block";
  const blocked = blockedByExit || blockedByDecision || deniedTool;
  const blockReason = blockedByExit
    ? stderr.trim() || output?.reason || "Blocked by hook"
    : deniedTool
      ? specific.permissionDecisionReason ||
        output?.reason ||
        stderr.trim() ||
        "Blocked by hook"
      : blockedByDecision
        ? output?.reason || stderr.trim() || "Blocked by hook"
        : undefined;
  return {
    additionalContext: specific?.additionalContext,
    blocked,
    blockReason,
  };
}

export interface AgentHookRunnerOptions {
  hostSandboxResolver?: HostSandboxResolver;
}

export class AgentHookRunner implements AgentHookExecutor {
  constructor(
    private readonly hooks: () => Promise<AgentHookDefinition[]>,
    private readonly options: AgentHookRunnerOptions = {},
  ) {}

  async run(
    event: AgentHookEvent,
    payload: unknown,
  ): Promise<AgentHookResult[]> {
    const configurationStartedAt = Date.now();
    let hooks: AgentHookDefinition[];
    try {
      const configuredHooks = validateHookDefinitions(await this.hooks());
      hooks = configuredHooks.filter(
        (hook) => hook.event === event && hook.enabled !== false,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        {
          hookId: "hook-configuration",
          event,
          status: "failed",
          stdout: "",
          stderr: `Hook configuration could not be loaded: ${message}`,
          durationMs: Date.now() - configurationStartedAt,
        },
      ];
    }
    const results: AgentHookResult[] = [];
    const sandboxPolicy = hostSandboxPolicyFromPayload(payload);
    for (const hook of hooks) {
      const result = await this.execute(hook, event, payload, sandboxPolicy);
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
    sandboxPolicy: HostSandboxPolicy | undefined,
  ): Promise<AgentHookResult> {
    const startedAt = Date.now();
    const baseCommand: AgentProcessCommand = {
      command: hook.command,
      args: hook.args,
      cwd: hook.cwd ?? hookWorkingDirectory(payload),
      env: { ...process.env, QIVRYN_HOOK_EVENT: event },
    };
    const sandboxResolution = sandboxPolicy
      ? (this.options.hostSandboxResolver ?? applyHostSandbox)(
          baseCommand,
          sandboxPolicy,
        )
      : undefined;
    if (
      sandboxResolution &&
      !sandboxResolution.enforced &&
      hook.trusted !== true
    ) {
      return Promise.resolve({
        hookId: hook.id,
        event,
        status: "skipped",
        stdout: "",
        stderr:
          "Read-only hook was not run because host sandbox enforcement is unavailable; set trusted=true only for a reviewed hook",
        durationMs: Date.now() - startedAt,
        sandbox: {
          applied: sandboxResolution.applied,
          enforced: sandboxResolution.enforced,
          mechanism: sandboxResolution.mechanism,
          ...(sandboxResolution.reason
            ? { reason: sandboxResolution.reason }
            : {}),
        },
      });
    }
    const command = sandboxResolution?.command ?? baseCommand;
    return new Promise((resolve) => {
      const child = spawn(command.command, command.args ?? [], {
        cwd: command.cwd,
        env: command.env,
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
          exitCode !== undefined
            ? parseHookOutput(hook, stdout, stderr, exitCode)
            : {};
        resolve({
          hookId: hook.id,
          event,
          status,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          ...(sandboxResolution
            ? {
                sandbox: {
                  applied: sandboxResolution.applied,
                  enforced: sandboxResolution.enforced,
                  mechanism: sandboxResolution.mechanism,
                  ...(sandboxResolution.reason
                    ? { reason: sandboxResolution.reason }
                    : {}),
                },
              }
            : {}),
          ...(sandboxResolution &&
          !sandboxResolution.enforced &&
          hook.trusted === true
            ? { trustedUnsandboxed: true }
            : {}),
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
