import fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import ChatGPTCodex, { effectiveCodexContextLength } from "./ChatGPTCodex.js";

describe("ChatGPTCodex context window", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    const originalReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (String(file).endsWith("models_cache.json")) {
        throw new Error("missing models cache");
      }
      return originalReadFileSync(file as any, args[0] as any);
    });

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

  it("routes through the Codex responses backend by default", () => {
    expect(new ChatGPTCodex({ model: "gpt-5.6-sol" }).chatgptBackendMode).toBe(
      "codex",
    );
    expect(
      new ChatGPTCodex({
        model: "gpt-5.6-sol",
        chatgptBackendMode: "chatgpt",
      }).chatgptBackendMode,
    ).toBe("chatgpt");
  });
});
