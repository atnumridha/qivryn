import { describe, expect, it } from "vitest";

import ChatGPTCodex, { effectiveCodexContextLength } from "./ChatGPTCodex.js";

describe("ChatGPTCodex context window", () => {
  it("applies the effective allowance from Codex model metadata", () => {
    expect(
      effectiveCodexContextLength("gpt-5.6-sol", {
        models: [
          {
            slug: "gpt-5.6-sol",
            context_window: 372_000,
            effective_context_window_percent: 95,
          },
        ],
      }),
    ).toBe(353_400);
  });

  it("uses the accurate GPT-5.6-Sol window and respects explicit overrides", () => {
    expect(new ChatGPTCodex({ model: "gpt-5.6-sol" }).contextLength).toBe(
      353_400,
    );
    expect(
      new ChatGPTCodex({
        model: "gpt-5.6-sol",
        contextLength: 200_000,
      }).contextLength,
    ).toBe(200_000);
  });
});
