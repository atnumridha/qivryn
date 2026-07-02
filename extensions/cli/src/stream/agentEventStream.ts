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
    | "runtime.notice";
  createdAt: string;
  payload: Record<string, unknown>;
}

export type AgentStreamRecordWriter = (record: AgentStreamRecord) => void;

export function isAgentEventStreamEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.CONTINUE_AGENT_EVENT_STREAM === "1";
}

function defaultWriter(record: AgentStreamRecord): void {
  safeStdout(`${JSON.stringify(record)}\n`);
}

export function createAgentEventStreamCallbacks(
  write: AgentStreamRecordWriter = defaultWriter,
): StreamCallbacks {
  const emit = (
    kind: AgentStreamRecord["kind"],
    payload: Record<string, unknown>,
  ) => write({ kind, payload, createdAt: new Date().toISOString() });

  return {
    onContent: (text) => {
      if (text) emit("message.assistant", { text, delta: true });
    },
    onToolStart: (toolName, args) =>
      emit("tool.started", {
        toolName,
        args,
        text: `Using ${toolName}`,
      }),
    onToolResult: (result, toolName, status) =>
      emit("tool.completed", {
        toolName,
        status,
        result,
        text: result || `${toolName} completed`,
      }),
    onToolError: (error, toolName) =>
      emit("tool.failed", {
        toolName,
        error,
        text: error,
      }),
    onSystemMessage: (message) =>
      emit("runtime.notice", { message, text: message }),
  };
}
