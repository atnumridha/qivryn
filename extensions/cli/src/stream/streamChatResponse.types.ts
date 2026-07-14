import { CompletionOptions } from "@qivryn/config-yaml";
import type { ToolStatus } from "core/index.js";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources.mjs";

import { ToolCallPreview } from "../tools/types.js";

export interface StreamCallbacks {
  onContent?: (content: string) => void;
  onContentComplete?: (content: string) => void;
  onToolStart?: (toolName: string, toolArgs?: any, toolCallId?: string) => void;
  onToolResult?: (
    result: string,
    toolName: string,
    status: ToolStatus,
    toolCallId?: string,
  ) => void;
  onToolError?: (error: string, toolName?: string, toolCallId?: string) => void;
  onToolPermissionRequest?: (
    toolName: string,
    toolArgs: any,
    requestId: string,
    preview?: ToolCallPreview[],
    toolCallId?: string,
  ) => void;
  onSystemMessage?: (message: string) => void;
  onCompactionStart?: (message: string) => void;
  onCompactionComplete?: (message: string) => void;
  onRecoveryComplete?: (message: string) => void;
}

export function getDefaultCompletionOptions(
  opts?: CompletionOptions,
  maxTokensOverride?: number,
): Partial<ChatCompletionCreateParamsStreaming> {
  if (!opts) {
    return maxTokensOverride === undefined
      ? {}
      : { max_tokens: maxTokensOverride };
  }
  return {
    max_tokens: maxTokensOverride ?? opts.maxTokens,
    temperature: opts.temperature,
    frequency_penalty: opts.frequencyPenalty,
    presence_penalty: opts.presencePenalty,
    top_p: opts.topP,
  };
}
