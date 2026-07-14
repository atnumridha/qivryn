import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentApprovalDecision,
  AgentEventKind,
  AgentRun,
} from "./contracts.js";
import {
  applyHostSandbox,
  type HostSandboxPolicy,
  type HostSandboxResolver,
} from "./hostSandbox.js";
import type { AgentHookExecutor } from "./hooks.js";
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  LocalAgentExecutor,
} from "./localRuntime.js";

export interface AgentProcessCommand {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface AgentProcessSpec extends AgentProcessCommand {
  setup?: AgentProcessCommand[];
  cleanup?: AgentProcessCommand[];
  hostSandbox?: HostSandboxPolicy;
}

export interface ProcessAgentExecutorOptions {
  resolveProcess(run: AgentRun): Promise<AgentProcessSpec> | AgentProcessSpec;
  terminateGraceMs?: number;
  hooks?: AgentHookExecutor;
  hostSandboxResolver?: HostSandboxResolver;
  /**
   * Headless agent processes write their conversational response to stdout.
   * Marking that stream as assistant output lets every client render the run as
   * a chat while stderr and process lifecycle events remain diagnostics.
   */
  stdoutEventKind?: "tool.output" | "message.assistant";
  /** Parse stdout as newline-delimited AgentEvent records with plain-text fallback. */
  stdoutProtocol?: "text" | "qivryn-agent-events";
  /** Emits a liveness event while the child is silent. Set to 0 to disable. */
  progressIntervalMs?: number;
}

const STREAM_EVENT_KINDS = new Set<AgentEventKind>([
  "message.user",
  "message.assistant",
  "message.reasoning",
  "tool.started",
  "tool.output",
  "tool.completed",
  "tool.failed",
  "approval.requested",
  "approval.resolved",
  "subagent.created",
  "subagent.updated",
  "file.changed",
  "context.compacted",
  "recovery.started",
  "recovery.completed",
  "run.progress",
  "runtime.notice",
]);

export class ProcessAgentExecutor implements LocalAgentExecutor {
  private readonly active = new Map<string, ChildProcess>();
  private readonly terminateGraceMs: number;

  constructor(private readonly options: ProcessAgentExecutorOptions) {
    this.terminateGraceMs = options.terminateGraceMs ?? 2_000;
  }

  async execute(
    run: AgentRun,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const spec = await this.options.resolveProcess(run);
    const blockReasons = await this.runHooks(
      "tool.before",
      { run, spec },
      context,
    );
    if (blockReasons.length > 0) {
      return { status: "attention", reason: blockReasons.join("\n") };
    }
    let setupStarted = false;
    try {
      for (const command of spec.setup ?? []) {
        setupStarted = true;
        await this.runLifecycleCommand(run, command, context.signal);
      }
      const result = await this.executeMainProcess(run, context, spec);
      await this.runHooks("tool.after", { run, spec, result }, context);
      return result;
    } finally {
      if (setupStarted || spec.cleanup?.length) {
        await this.runCleanup(run, spec.cleanup ?? []);
      }
    }
  }

  private async executeMainProcess(
    run: AgentRun,
    context: AgentExecutionContext,
    spec: AgentProcessSpec,
  ): Promise<AgentExecutionResult> {
    const workingDirectory =
      spec.cwd ?? run.workspace.worktreePath ?? run.workspace.repositoryPath;
    const sandboxResolution = spec.hostSandbox
      ? (this.options.hostSandboxResolver ?? applyHostSandbox)(
          {
            command: spec.command,
            args: spec.args,
            cwd: workingDirectory,
            env: spec.env,
          },
          spec.hostSandbox,
        )
      : undefined;
    const command = sandboxResolution?.command ?? spec;
    const child = spawn(command.command, command.args ?? [], {
      cwd: workingDirectory,
      env: command.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.active.set(run.id, child);
    await context.emit({
      kind: "tool.started",
      createdAt: new Date().toISOString(),
      payload: {
        command: command.command,
        args: command.args ?? [],
        sandboxed: sandboxResolution?.enforced ?? false,
        sandbox: {
          requested: Boolean(spec.hostSandbox),
          applied: sandboxResolution?.applied ?? false,
          enforced: sandboxResolution?.enforced ?? false,
          mechanism: sandboxResolution?.mechanism ?? "none",
          ...(sandboxResolution?.reason
            ? { reason: sandboxResolution.reason }
            : {}),
        },
        pid: child.pid,
        text: "Agent process started",
        scope: "process",
      },
    });

    const terminate = () => this.terminate(child);
    context.signal.addEventListener("abort", terminate, { once: true });
    let eventWrites = Promise.resolve();
    let streamError: unknown;
    const emit = (
      event: Parameters<AgentExecutionContext["emit"]>[0],
    ): void => {
      eventWrites = eventWrites
        .then(() => context.emit(event))
        .catch((error) => {
          streamError ??= error;
        });
    };
    const streamText = (channel: "stdout" | "stderr", text: string) =>
      emit({
        kind:
          channel === "stdout" &&
          this.options.stdoutEventKind === "message.assistant"
            ? "message.assistant"
            : "tool.output",
        createdAt: new Date().toISOString(),
        payload: { channel, text },
      });
    let stdoutBuffer = "";
    let assistantDeltaBuffer = "";
    let assistantDeltaCreatedAt: string | undefined;
    let assistantDeltaTimer: NodeJS.Timeout | undefined;
    const flushAssistantDelta = (): void => {
      if (assistantDeltaTimer) clearTimeout(assistantDeltaTimer);
      assistantDeltaTimer = undefined;
      if (!assistantDeltaBuffer) return;
      emit({
        kind: "message.assistant",
        createdAt: assistantDeltaCreatedAt ?? new Date().toISOString(),
        payload: { text: assistantDeltaBuffer, delta: true },
      });
      assistantDeltaBuffer = "";
      assistantDeltaCreatedAt = undefined;
    };
    const parseStdoutLine = (line: string): void => {
      if (!line) return;
      try {
        const record = JSON.parse(line) as {
          kind?: AgentEventKind;
          createdAt?: string;
          payload?: unknown;
        };
        if (record.kind && STREAM_EVENT_KINDS.has(record.kind)) {
          if (
            record.kind === "message.assistant" &&
            record.payload &&
            typeof record.payload === "object" &&
            (record.payload as Record<string, unknown>).delta === true &&
            typeof (record.payload as Record<string, unknown>).text === "string"
          ) {
            assistantDeltaBuffer += (record.payload as { text: string }).text;
            assistantDeltaCreatedAt ??= record.createdAt;
            if (assistantDeltaBuffer.length >= 512) {
              flushAssistantDelta();
            } else if (!assistantDeltaTimer) {
              assistantDeltaTimer = setTimeout(flushAssistantDelta, 80);
              assistantDeltaTimer.unref();
            }
            return;
          }
          flushAssistantDelta();
          emit({
            kind: record.kind,
            createdAt:
              typeof record.createdAt === "string"
                ? record.createdAt
                : new Date().toISOString(),
            payload: record.payload ?? {},
          });
          return;
        }
      } catch {
        // Older workers emit plain text; retain compatibility below.
      }
      streamText("stdout", `${line}\n`);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (this.options.stdoutProtocol !== "qivryn-agent-events") {
        streamText("stdout", text);
        return;
      }
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) parseStdoutLine(line);
    });
    child.stderr.on("data", (chunk: Buffer) =>
      streamText("stderr", chunk.toString("utf8")),
    );
    const startedAt = Date.now();
    const progressIntervalMs = this.options.progressIntervalMs ?? 2_000;
    const progressTimer =
      progressIntervalMs > 0
        ? setInterval(
            () =>
              emit({
                kind: "run.progress",
                createdAt: new Date().toISOString(),
                payload: {
                  state: "working",
                  elapsedMs: Date.now() - startedAt,
                  text: "Agent is working…",
                },
              }),
            progressIntervalMs,
          )
        : undefined;
    progressTimer?.unref();

    try {
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      if (stdoutBuffer) parseStdoutLine(stdoutBuffer);
      flushAssistantDelta();
      await eventWrites;
      if (streamError) throw streamError;
      await context.emit({
        kind: result.code === 0 ? "tool.completed" : "tool.failed",
        createdAt: new Date().toISOString(),
        payload: result,
      });
      if (context.signal.aborted) {
        return { status: "failed", reason: "process-canceled" };
      }
      return result.code === 0
        ? { status: "completed" }
        : {
            status: "failed",
            reason: `Process exited with ${result.code ?? result.signal ?? "unknown"}`,
          };
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      if (assistantDeltaTimer) clearTimeout(assistantDeltaTimer);
      context.signal.removeEventListener("abort", terminate);
      this.active.delete(run.id);
    }
  }

  private async runLifecycleCommand(
    run: AgentRun,
    command: AgentProcessCommand,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new Error("Agent process setup canceled");
    const child = spawn(command.command, command.args ?? [], {
      cwd:
        command.cwd ??
        run.workspace.worktreePath ??
        run.workspace.repositoryPath,
      env: command.env ?? process.env,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.active.set(run.id, child);
    const terminate = () => this.terminate(child);
    signal?.addEventListener("abort", terminate, { once: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    try {
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, childSignal) =>
          resolve({ code, signal: childSignal }),
        );
      });
      if (result.code !== 0) {
        const reason =
          stderr.trim() || result.signal || result.code || "unknown";
        throw new Error(
          `Agent lifecycle command ${command.command} failed: ${reason}`,
        );
      }
    } finally {
      signal?.removeEventListener("abort", terminate);
      if (this.active.get(run.id) === child) this.active.delete(run.id);
    }
  }

  private async runHooks(
    event: "tool.before" | "tool.after",
    payload: unknown,
    context: AgentExecutionContext,
  ): Promise<string[]> {
    if (!this.options.hooks) return [];
    const results = await this.options.hooks.run(event, payload);
    for (const result of results) {
      await context.emit({
        kind: "runtime.notice",
        createdAt: new Date().toISOString(),
        payload: { type: "hook.result", result },
      });
    }
    return results
      .filter((result) => result.blocked)
      .map((result) => result.blockReason ?? "Blocked by hook");
  }

  private async runCleanup(
    run: AgentRun,
    commands: readonly AgentProcessCommand[],
  ): Promise<void> {
    for (const command of commands) {
      try {
        await this.runLifecycleCommand(run, command);
      } catch {
        // Cleanup is best effort and must not replace the process result.
      }
    }
  }

  async cancel(run: AgentRun): Promise<void> {
    const child = this.active.get(run.id);
    if (child) this.terminate(child);
  }

  async resolveApproval(
    run: AgentRun,
    approvalId: string,
    decision: AgentApprovalDecision,
  ): Promise<void> {
    const child = this.active.get(run.id);
    const input = child?.stdin;
    if (!child || !input || input.destroyed || !input.writable) {
      throw new Error(`Agent process ${run.id} cannot accept approval input`);
    }
    await new Promise<void>((resolve, reject) => {
      input.write(
        `${JSON.stringify({
          action: "approval.resolve",
          approvalId,
          decision,
        })}\n`,
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async steer(
    run: AgentRun,
    queueItemId: string,
    prompt: string,
  ): Promise<void> {
    const child = this.active.get(run.id);
    const input = child?.stdin;
    if (!child || !input || input.destroyed || !input.writable) {
      throw new Error(`Agent process ${run.id} cannot accept steering input`);
    }
    await new Promise<void>((resolve, reject) => {
      input.write(
        `${JSON.stringify({
          action: "message.enqueue",
          queueItemId,
          message: prompt,
        })}\n`,
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  private terminate(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, this.terminateGraceMs);
    timer.unref();
  }
}
