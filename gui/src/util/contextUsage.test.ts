import { describe, expect, it } from "vitest";
import {
  contextUsagePresentation,
  formatTokenCount,
  reconcileContextUsageSnapshot,
} from "./contextUsage";

describe("context usage presentation", () => {
  it("formats common context-window sizes compactly", () => {
    expect(formatTokenCount(160_000)).toBe("160K");
    expect(formatTokenCount(353_400)).toBe("353K");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });

  it("displays the effective GPT-5.6-Sol context window", () => {
    expect(
      contextUsagePresentation(
        { inputTokens: 102_000, contextLength: 353_400 },
        353_400,
      ),
    ).toEqual({
      short: "102K / 353K",
      accessible: "Context window: 102,000 of 353,400 tokens used (29%).",
      percent: 29,
    });
  });

  it("reconciles a persisted 128K snapshot with current Codex metadata", () => {
    expect(
      reconcileContextUsageSnapshot(
        {
          inputTokens: 246_000,
          contextLength: 128_000,
          availableTokens: 0,
          model: "gpt-5.6-sol",
        },
        353_400,
        "gpt-5.6-sol",
      ),
    ).toEqual({
      usage: {
        inputTokens: 246_000,
        contextLength: 353_400,
        availableTokens: 107_400,
        model: "gpt-5.6-sol",
      },
      isStale: false,
    });
  });

  it("does not reuse usage measured for a different model", () => {
    expect(
      reconcileContextUsageSnapshot(
        {
          inputTokens: 100_000,
          contextLength: 128_000,
          model: "another-model",
        },
        353_400,
        "gpt-5.6-sol",
      ),
    ).toEqual({ usage: undefined, isStale: true });
  });

  it("reports exact used and total tokens", () => {
    expect(
      contextUsagePresentation(
        { inputTokens: 160_000, contextLength: 200_000 },
        32_768,
      ),
    ).toEqual({
      short: "160K / 200K",
      accessible: "Context window: 160,000 of 200,000 tokens used (80%).",
      percent: 80,
    });
  });
});
