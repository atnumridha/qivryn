import { ModelDescription } from "core";
import { describe, expect, it } from "vitest";
import { getEmptyRootState } from "../../util/test/mockStore";
import {
  selectSelectedChatModel,
  selectSelectedChatModelContextLength,
} from "./configSlice";

describe("config selectors", () => {
  it("falls back to the first chat model when the selected chat slot is empty", () => {
    const fallbackModel: ModelDescription = {
      title: "Codex: GPT-5.5",
      model: "gpt-5.5",
      provider: "chatgpt-codex",
      underlyingProviderName: "chatgpt-codex",
      contextLength: 123_456,
    };
    const state = getEmptyRootState();

    state.config.config.modelsByRole.chat = [fallbackModel];
    state.config.config.selectedModelByRole.chat = null;

    expect(selectSelectedChatModel(state)).toBe(fallbackModel);
    expect(selectSelectedChatModelContextLength(state)).toBe(123_456);
  });
});
