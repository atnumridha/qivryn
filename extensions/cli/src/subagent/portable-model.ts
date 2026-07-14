import type { ModelConfig } from "@qivryn/config-yaml";

import { createLlmApi } from "../config.js";
import type { ModelServiceState } from "../services/types.js";
import { logger } from "../util/logger.js";

import type { PortableSubagentDefinition } from "./load-agents.js";

export type PortableSubagentModelConfig = ModelConfig & {
  portableSubagent?: PortableSubagentDefinition;
};

export type ResolvedPortableSubagentState = ModelServiceState & {
  llmApi: NonNullable<ModelServiceState["llmApi"]>;
  model: PortableSubagentModelConfig;
};

export function getPortableSubagentDefinition(
  model: ModelConfig | null,
): PortableSubagentDefinition | undefined {
  return (model as PortableSubagentModelConfig | null)?.portableSubagent;
}

export function resolvePortableSubagentModelConfig(
  agent: PortableSubagentDefinition,
  modelState: ModelServiceState,
): ModelConfig | null {
  const baseModel = modelState.model;
  if (!baseModel) return null;

  const requestedModel = agent.model?.trim();
  if (!requestedModel || requestedModel === "inherit") return baseModel;

  return (
    modelState.assistant?.models?.find(
      (model) =>
        model?.name === requestedModel || model?.model === requestedModel,
    ) ?? null
  );
}

export function createPortableSubagentState(
  agent: PortableSubagentDefinition,
  modelState: ModelServiceState,
): ResolvedPortableSubagentState | null {
  const executionModel = resolvePortableSubagentModelConfig(agent, modelState);
  if (!executionModel) {
    logger.warn("Skipping portable subagent with unavailable model", {
      agent: agent.name,
      requestedModel: agent.model,
    });
    return null;
  }

  const llmApi =
    executionModel === modelState.model
      ? modelState.llmApi
      : createLlmApi(executionModel, modelState.authConfig);
  if (!llmApi) {
    logger.warn("Skipping portable subagent whose model could not initialize", {
      agent: agent.name,
      requestedModel: agent.model,
    });
    return null;
  }

  return {
    llmApi,
    model: {
      ...executionModel,
      name: agent.name,
      roles: ["subagent"],
      chatOptions: {
        ...executionModel.chatOptions,
        baseSystemMessage: [agent.description, agent.prompt]
          .filter(Boolean)
          .join("\n\n"),
      },
      portableSubagent: agent,
    } as PortableSubagentModelConfig,
    assistant: modelState.assistant,
    authConfig: modelState.authConfig,
  };
}
