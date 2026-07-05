import { safeStdout } from "../init.js";
import type { StreamCallbacks } from "./streamChatResponse.types.js";

export interface AgentStreamRecord {
  kind:
    | "message.assistant"
    | "message.reasoning"
    | "tool.started"
    | "tool.output"
    | "tool.completed"
    | "tool.failed"
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

export function isAgentEventStreamEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.QIVRYN_AGENT_EVENT_STREAM === "1";
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
    onToolStart: (toolName, args) => {
      if (args && typeof args === "object") activeToolArgs.set(toolName, args);
      if (toolName === "subagent") {
        emit("subagent.created", {
          name: args?.subagent_name,
          prompt: args?.prompt,
          status: "running",
          text: `Started ${args?.subagent_name ?? "subagent"}`,
        });
      }
      emit("tool.started", {
        toolName,
        args,
        text: `Using ${toolName}`,
      });
    },
    onToolResult: (result, toolName, status) => {
      const args = activeToolArgs.get(toolName);
      activeToolArgs.delete(toolName);
      emit("tool.completed", {
        toolName,
        status,
        result,
        text: result || `${toolName} completed`,
      });
      if (toolName === "subagent") {
        emit("subagent.updated", {
          name: args?.subagent_name,
          status: status === "canceled" ? "failed" : "completed",
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
    onToolError: (error, toolName) =>
      emit("tool.failed", {
        toolName,
        error,
        text: error,
      }),
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
