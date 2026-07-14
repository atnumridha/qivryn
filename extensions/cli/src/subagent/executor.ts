import type { ChatHistoryItem } from "core";

import { SANDBOX_MODE_POLICIES } from "../permissions/defaultPolicies.js";
import { matchesToolPattern } from "../permissions/permissionChecker.js";
import type {
  ToolPermissionPolicy,
  ToolPermissions,
} from "../permissions/types.js";
import { ChatHistoryService } from "../services/ChatHistoryService.js";
import {
  runWithServiceOverrides,
  services,
  type ServicesType,
} from "../services/index.js";
import type {
  ToolPermissionService,
  ToolPermissionServiceState,
} from "../services/ToolPermissionService.js";
import { ModelServiceState } from "../services/types.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";
import { escapeEvents } from "../util/cli.js";
import { logger } from "../util/logger.js";

import { getPortableSubagentDefinition } from "./portable-model.js";

/**
 * Options for executing a subagent
 */
export interface SubAgentExecutionOptions {
  agent: ModelServiceState;
  prompt: string;
  parentSessionId: string;
  abortController: AbortController;
  onOutputUpdate?: (output: string) => void;
}

/**
 * Result from executing a subagent
 */
export interface SubAgentResult {
  success: boolean;
  response: string;
  error?: string;
}

/**
 * Build system message for the agent
 */
async function buildAgentSystemMessage(
  agent: ModelServiceState,
  systemMessageService: ServicesType["systemMessage"],
  toolPermissionService: ServicesType["toolPermissions"],
): Promise<string> {
  const baseMessage = await systemMessageService.getSystemMessage(
    toolPermissionService.getState().currentMode,
  );

  const agentPrompt = agent.model?.chatOptions?.baseSystemMessage || "";

  // Combine base system message with agent-specific prompt
  if (agentPrompt) {
    return `${baseMessage}\n\n${agentPrompt}`;
  }

  return baseMessage;
}

const READONLY_TOOL_NAMES = new Set(
  SANDBOX_MODE_POLICIES.filter(
    ({ tool, permission }) => tool !== "*" && permission !== "exclude",
  ).map(({ tool }) => tool),
);

function restrictPermissions(
  parent: ToolPermissions,
  allowedToolNames: Set<string>,
): ToolPermissions {
  const allowed = [...allowedToolNames];
  const policies: ToolPermissionPolicy[] = parent.policies.flatMap((policy) => {
    if (policy.tool === "*") {
      return allowed.map((tool) => ({ ...policy, tool }));
    }

    const commandPattern = policy.tool.match(/^([^()]+)\(.+\)$/);
    if (commandPattern) {
      return allowedToolNames.has(commandPattern[1]) ? [policy] : [];
    }

    return allowed
      .filter((tool) => matchesToolPattern(tool, policy.tool, {}))
      .map((tool) => ({ ...policy, tool }));
  });

  // No matching parent policy means "ask" in the permission checker. Preserve
  // that default for allowed tools, then exclude everything outside the scope.
  policies.push(
    ...allowed.map(
      (tool): ToolPermissionPolicy => ({ tool, permission: "ask" }),
    ),
    { tool: "*", permission: "exclude" },
  );

  return { ...parent, policies };
}

function createScopedToolPermissionService(
  subAgent: ModelServiceState,
  parentService: ToolPermissionService,
): ToolPermissionService {
  const definition = getPortableSubagentDefinition(subAgent.model);
  if (!definition) return parentService;

  let allowedToolNames = definition.tools
    ? new Set(definition.tools)
    : undefined;
  if (definition.permissionMode === "readonly") {
    allowedToolNames = allowedToolNames
      ? new Set(
          [...allowedToolNames].filter((tool) => READONLY_TOOL_NAMES.has(tool)),
        )
      : new Set(READONLY_TOOL_NAMES);
  }

  if (!allowedToolNames) return parentService;

  const parentState = parentService.getState();
  const scopedState: ToolPermissionServiceState = {
    ...parentState,
    permissions: restrictPermissions(parentState.permissions, allowedToolNames),
    currentMode:
      definition.permissionMode === "readonly"
        ? "sandbox"
        : parentState.currentMode,
  };

  return new Proxy(parentService, {
    get(target, property, receiver) {
      if (property === "getState") return () => scopedState;
      if (property === "getPermissions") return () => scopedState.permissions;
      if (property === "getCurrentMode") return () => scopedState.currentMode;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Execute a subagent in a child session
 */
export async function executeSubAgent(
  options: SubAgentExecutionOptions,
): Promise<SubAgentResult> {
  const { agent: subAgent, prompt, abortController, onOutputUpdate } = options;

  try {
    logger.debug("Starting subagent execution", {
      agent: subAgent.model?.name,
    });

    const { model, llmApi } = subAgent;
    if (!model || !llmApi) {
      throw new Error("Model or LLM API not available");
    }

    const scopedToolPermissions = createScopedToolPermissionService(
      subAgent,
      services.toolPermissions,
    );

    // Build the prompt for the child permission mode without mutating parent services.
    const systemMessage = await buildAgentSystemMessage(
      subAgent,
      services.systemMessage,
      scopedToolPermissions,
    );

    const chatHistory = [
      {
        message: {
          role: "user",
          content: prompt,
        },
        contextItems: [],
      },
    ] as ChatHistoryItem[];
    const childHistoryService = new ChatHistoryService();
    await childHistoryService.initialize(
      {
        sessionId: `${options.parentSessionId}:subagent:${Date.now()}`,
        history: chatHistory,
      },
      true,
    );
    const scopedSystemMessage = new Proxy(services.systemMessage, {
      get(target, property, receiver) {
        if (property === "getSystemMessage") {
          return async () => systemMessage;
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const escapeHandler = () => {
      abortController.abort();
      childHistoryService.addUserMessage(
        "Subagent execution was cancelled by the user.",
      );
    };

    escapeEvents.on("user-escape", escapeHandler);

    try {
      let accumulatedOutput = "";

      // Execute the chat stream with child session
      await runWithServiceOverrides(
        {
          chatHistory: childHistoryService,
          systemMessage: scopedSystemMessage,
          toolPermissions: scopedToolPermissions,
        },
        () =>
          streamChatResponse(
            chatHistory,
            model,
            llmApi,
            abortController,
            {
              onContent: (content: string) => {
                accumulatedOutput += content;
                onOutputUpdate?.(accumulatedOutput);
              },
              onToolResult: (result: string) => {
                accumulatedOutput += `\n\n${result}`;
                onOutputUpdate?.(accumulatedOutput);
              },
            },
            false,
          ),
      );

      // The last message (mostly) contains the important output to be submitted back to the main agent
      const lastMessage = childHistoryService.getHistory().at(-1);
      const response =
        typeof lastMessage?.message?.content === "string"
          ? lastMessage.message.content
          : "";

      logger.debug("Subagent execution completed", {
        agent: model?.name,
        responseLength: response.length,
      });

      return {
        success: true,
        response,
      };
    } finally {
      if (escapeHandler) {
        escapeEvents.removeListener("user-escape", escapeHandler);
      }

      await childHistoryService.cleanup();
    }
  } catch (error: any) {
    logger.error("Subagent execution failed", {
      agent: subAgent.model?.name,
      error: error.message,
    });

    return {
      success: false,
      response: "",
      error: error.message,
    };
  }
}
