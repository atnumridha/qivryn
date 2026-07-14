import { closeSync, openSync } from "node:fs";
import { createInterface } from "node:readline";
import { ReadStream } from "node:tty";

import { safeStdout } from "../init.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";

import type { SteeringDisposition } from "./messageQueue.js";
import type { StreamCallbacks } from "./streamChatResponse.types.js";

export interface AgentStreamRecord {
  kind:
    | "message.user"
    | "message.assistant"
    | "message.reasoning"
    | "tool.started"
    | "tool.output"
    | "tool.completed"
    | "tool.failed"
    | "approval.requested"
    | "context.compacted"
    | "recovery.started"
    | "recovery.completed"
    | "subagent.created"
    | "subagent.updated"
    | "file.changed"
    | "runtime.notice";
  createdAt: string;
  payload: Record<string, unknown>;
}

export type AgentStreamRecordWriter = (record: AgentStreamRecord) => void;

export interface AgentControlStreamOptions {
  steerMessage?: (
    message: string,
    queueItemId: string,
  ) => Promise<SteeringDisposition> | SteeringDisposition;
  write?: AgentStreamRecordWriter;
}

export interface InteractiveStdinDependencies {
  open(path: string, flags: "r"): number;
  createReadStream(fd: number): NodeJS.ReadStream;
  close(fd: number): void;
}

export function getInteractiveStdinDevice(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "CONIN$" : "/dev/tty";
}

export function openInteractiveStdin(
  platform: NodeJS.Platform = process.platform,
  dependencies: Partial<InteractiveStdinDependencies> = {},
): NodeJS.ReadStream {
  const device = getInteractiveStdinDevice(platform);
  const open = dependencies.open ?? openSync;
  const createReadStream =
    dependencies.createReadStream ?? ((fd: number) => new ReadStream(fd));
  const close = dependencies.close ?? closeSync;
  let fd: number;

  try {
    fd = open(device, "r");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to open interactive stdin ${device}: ${detail}`);
  }

  try {
    return createReadStream(fd);
  } catch (error) {
    close(fd);
    throw error;
  }
}

function sanitizedApprovalArgs(value: unknown, key = ""): unknown {
  if (
    /password|passphrase|secret|token|api.?key|authorization|cookie|content|base64|^text$/i.test(
      key,
    )
  ) {
    return typeof value === "string"
      ? `[redacted ${value.length} characters]`
      : "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizedApprovalArgs(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizedApprovalArgs(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

export function isAgentEventStreamEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.QIVRYN_AGENT_EVENT_STREAM === "1";
}

export function isAgentControlStreamEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isAgentEventStreamEnabled(environment) &&
    environment.QIVRYN_AGENT_CONTROL_STREAM === "1"
  );
}

export function startAgentControlStream(
  input: NodeJS.ReadableStream = process.stdin,
  options: AgentControlStreamOptions = {},
): () => void {
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    try {
      const record = JSON.parse(line) as {
        action?: string;
        approvalId?: string;
        decision?: string;
        queueItemId?: string;
        message?: string;
      };
      if (
        record.action === "message.enqueue" &&
        record.queueItemId &&
        record.message?.trim() &&
        options.steerMessage
      ) {
        const message = record.message.trim();
        const write = options.write ?? defaultWriter;
        let disposition: SteeringDisposition;
        try {
          disposition = await options.steerMessage(message, record.queueItemId);
        } catch (error) {
          write({
            kind: "runtime.notice",
            createdAt: new Date().toISOString(),
            payload: {
              type: "steering.deferred",
              queueItemId: record.queueItemId,
              status: "deferred",
              text: "Follow-up queued for the next agent turn",
              error: error instanceof Error ? error.message : String(error),
            },
          });
          return;
        }

        if (disposition === "delivered") {
          write({
            kind: "message.user",
            createdAt: new Date().toISOString(),
            payload: { text: message, queueItemId: record.queueItemId },
          });
          write({
            kind: "runtime.notice",
            createdAt: new Date().toISOString(),
            payload: {
              type: "steering.accepted",
              queueItemId: record.queueItemId,
              status: "delivered",
              text: "Follow-up delivered to the active agent turn",
            },
          });
        } else {
          write({
            kind: "runtime.notice",
            createdAt: new Date().toISOString(),
            payload: {
              type: "steering.deferred",
              queueItemId: record.queueItemId,
              status: "deferred",
              text: "Follow-up queued for the next agent turn",
            },
          });
        }
        return;
      }
      if (
        record.action !== "approval.resolve" ||
        !record.approvalId ||
        !["approve", "approveAlways", "reject"].includes(record.decision ?? "")
      ) {
        return;
      }
      if (record.decision === "reject") {
        toolPermissionManager.rejectRequest(record.approvalId);
      } else {
        toolPermissionManager.approveRequest(
          record.approvalId,
          record.decision === "approveAlways",
        );
      }
    } catch {
      // The parent process only sends typed control records. Ignore malformed input.
    }
  });
  lines.on("close", () => toolPermissionManager.rejectAllPending());
  return () => lines.close();
}

function defaultWriter(record: AgentStreamRecord): void {
  safeStdout(`${JSON.stringify(record)}\n`);
}

export function createAgentEventStreamCallbacks(
  write: AgentStreamRecordWriter = defaultWriter,
): StreamCallbacks {
  const activeToolArgs = new Map<string, Record<string, unknown>>();
  const emit = (
    kind: AgentStreamRecord["kind"],
    payload: Record<string, unknown>,
  ) => write({ kind, payload, createdAt: new Date().toISOString() });

  return {
    onContent: (text) => {
      if (text) emit("message.assistant", { text, delta: true });
    },
    onToolStart: (toolName, args, toolCallId) => {
      const key = toolCallId ?? toolName;
      if (args && typeof args === "object") activeToolArgs.set(key, args);
      if (toolName === "subagent") {
        emit("subagent.created", {
          conversationId: toolCallId,
          name: args?.subagent_name,
          prompt: args?.prompt,
          status: "running",
          text: `Started ${args?.subagent_name ?? "subagent"}`,
        });
      }
      emit("tool.started", {
        toolName,
        toolCallId,
        args: sanitizedApprovalArgs(args),
        text: `Using ${toolName}`,
      });
    },
    onToolResult: (result, toolName, status, toolCallId) => {
      const key = toolCallId ?? toolName;
      const args = activeToolArgs.get(key);
      activeToolArgs.delete(key);
      emit("tool.completed", {
        toolName,
        toolCallId,
        status,
        result,
        text: result || `${toolName} completed`,
      });
      if (toolName === "subagent") {
        emit("subagent.updated", {
          conversationId: toolCallId,
          name: args?.subagent_name,
          status: status === "done" ? "completed" : "failed",
          text: result || `${args?.subagent_name ?? "Subagent"} completed`,
        });
      }
      if (/write|edit|patch|create.*file/i.test(toolName)) {
        const filepath = args?.path ?? args?.filepath ?? args?.file;
        if (typeof filepath === "string") {
          emit("file.changed", {
            path: filepath,
            operation: toolName,
            status,
            text: `${filepath} changed`,
          });
        }
      }
    },
    onToolError: (error, toolName, toolCallId) => {
      const key = toolCallId ?? toolName;
      const args = key ? activeToolArgs.get(key) : undefined;
      if (key) activeToolArgs.delete(key);
      emit("tool.failed", {
        toolName,
        toolCallId,
        error,
        text: error,
      });
      if (toolName === "subagent") {
        emit("subagent.updated", {
          conversationId: toolCallId,
          name: args?.subagent_name,
          status: "failed",
          text: error,
        });
      }
    },
    onToolPermissionRequest: (
      toolName,
      args,
      requestId,
      preview,
      toolCallId,
    ) => {
      const paths = [
        args?.path,
        args?.filepath,
        args?.file,
        ...(Array.isArray(args?.paths) ? args.paths : []),
      ].filter((value): value is string => typeof value === "string");
      emit("approval.requested", {
        id: requestId,
        approvalId: requestId,
        title: `Allow ${toolName}?`,
        toolName,
        toolCallId,
        detail: `Qivryn wants to use ${toolName}`,
        command: typeof args?.command === "string" ? args.command : undefined,
        paths: paths.length > 0 ? paths : undefined,
        args: sanitizedApprovalArgs(args),
        preview,
        status: "pending",
      });
    },
    onSystemMessage: (message) =>
      emit("runtime.notice", { message, text: message }),
    onCompactionStart: (message) =>
      emit("recovery.started", {
        reason: "context-compaction",
        message,
        text: message,
      }),
    onCompactionComplete: (message) =>
      emit("context.compacted", { message, text: message }),
    onRecoveryComplete: (message) =>
      emit("recovery.completed", { message, text: message }),
  };
}
