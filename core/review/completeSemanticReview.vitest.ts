import { describe, expect, it, vi } from "vitest";

import { completeSemanticReview } from "./completeSemanticReview.js";

describe("completeSemanticReview", () => {
  it("uses the model chat transport with deterministic review options", async () => {
    const signal = new AbortController().signal;
    const chat = vi.fn().mockResolvedValue({
      role: "assistant",
      content: '[{"title":"Finding"}]',
    });

    await expect(
      completeSemanticReview(
        { chat, providerName: "openai" },
        "Review this diff",
        signal,
      ),
    ).resolves.toBe('[{"title":"Finding"}]');
    expect(chat).toHaveBeenCalledWith(
      [{ role: "user", content: "Review this diff" }],
      signal,
      { temperature: 0, maxTokens: 4_000 },
    );
  });

  it("omits unsupported sampling options for ChatGPT Codex", async () => {
    const signal = new AbortController().signal;
    const chat = vi.fn().mockResolvedValue({
      role: "assistant",
      content: "[]",
    });

    await completeSemanticReview(
      { chat, providerName: "chatgpt-codex" },
      "Review",
      signal,
    );

    expect(chat).toHaveBeenCalledWith(
      [{ role: "user", content: "Review" }],
      signal,
      { maxTokens: 4_000 },
    );
  });

  it("normalizes multipart assistant responses to text", async () => {
    const chat = vi.fn().mockResolvedValue({
      role: "assistant",
      content: [
        { type: "text", text: "[" },
        { type: "imageUrl", imageUrl: { url: "data:image/png;base64,AA==" } },
        { type: "text", text: "]" },
      ],
    });

    await expect(
      completeSemanticReview(
        { chat, providerName: "openai" },
        "Review",
        new AbortController().signal,
      ),
    ).resolves.toBe("[\n]");
  });
});
