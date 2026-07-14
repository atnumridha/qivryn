import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortableSubagentDefinition } from "./load-agents.js";
import {
  createPortableSubagentState,
  resolvePortableSubagentModelConfig,
} from "./portable-model.js";

const createLlmApi = vi.hoisted(() => vi.fn());

vi.mock("../config.js", () => ({ createLlmApi }));

function definition(
  overrides: Partial<PortableSubagentDefinition> = {},
): PortableSubagentDefinition {
  return {
    name: "reviewer",
    prompt: "Review the change.",
    permissionMode: "default",
    background: false,
    sourceFile: "/tmp/reviewer.md",
    ...overrides,
  };
}

function modelState() {
  const baseModel = {
    name: "parent",
    provider: "openai",
    model: "parent-id",
    chatOptions: { temperature: 0.2 },
  };
  const fastModel = {
    name: "fast-model",
    provider: "anthropic",
    model: "fast-id",
    chatOptions: { temperature: 0 },
  };
  return {
    baseModel,
    fastModel,
    state: {
      model: baseModel,
      llmApi: { id: "parent-api" },
      assistant: { models: [baseModel, fastModel] },
      authConfig: {},
    } as any,
  };
}

describe("portable subagent model selection", () => {
  beforeEach(() => {
    createLlmApi.mockReset();
  });

  it("inherits the parent model when model is omitted or inherit", () => {
    const { baseModel, state } = modelState();

    expect(resolvePortableSubagentModelConfig(definition(), state)).toBe(
      baseModel,
    );
    expect(
      resolvePortableSubagentModelConfig(
        definition({ model: "inherit" }),
        state,
      ),
    ).toBe(baseModel);

    const resolved = createPortableSubagentState(definition(), state);
    expect(resolved?.llmApi).toBe(state.llmApi);
    expect(resolved?.model).toMatchObject({
      name: "reviewer",
      model: "parent-id",
      portableSubagent: expect.objectContaining({ name: "reviewer" }),
    });
    expect(createLlmApi).not.toHaveBeenCalled();
  });

  it("uses an explicitly configured model and initializes its API", () => {
    const { fastModel, state } = modelState();
    const selectedApi = { id: "fast-api" };
    createLlmApi.mockReturnValue(selectedApi);

    const resolved = createPortableSubagentState(
      definition({ model: "fast-model" }),
      state,
    );

    expect(createLlmApi).toHaveBeenCalledWith(fastModel, state.authConfig);
    expect(resolved?.llmApi).toBe(selectedApi);
    expect(resolved?.model).toMatchObject({
      name: "reviewer",
      provider: "anthropic",
      model: "fast-id",
      chatOptions: {
        temperature: 0,
        baseSystemMessage: "Review the change.",
      },
    });
  });

  it("does not silently fall back when the requested model is unavailable", () => {
    const { state } = modelState();
    const agent = definition({ model: "missing-model" });

    expect(resolvePortableSubagentModelConfig(agent, state)).toBeNull();
    expect(createPortableSubagentState(agent, state)).toBeNull();
    expect(createLlmApi).not.toHaveBeenCalled();
  });
});
