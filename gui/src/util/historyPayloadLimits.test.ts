import type { ContextItem, PromptLog } from "core";
import { describe, expect, it } from "vitest";
import {
  limitPromptLogsForHistory,
  limitToolContextItemsForHistory,
} from "./historyPayloadLimits";

describe("history payload limits", () => {
  it("keeps prompt logs bounded before they are persisted", () => {
    const promptLog: PromptLog = {
      modelProvider: "test",
      modelTitle: "test-model",
      prompt: "p".repeat(30_000),
      completion: "c".repeat(30_000),
    };

    const [bounded] = limitPromptLogsForHistory([promptLog]);

    expect(bounded.prompt.length).toBeLessThan(promptLog.prompt.length);
    expect(bounded.completion.length).toBeLessThan(promptLog.completion.length);
    expect(bounded.prompt).toContain("prompt log truncated");
    expect(bounded.completion).toContain("completion log truncated");
  });

  it("keeps large tool outputs bounded before they are persisted", () => {
    const contextItems: ContextItem[] = [
      {
        name: "Terminal",
        description: "Command output",
        content: "x".repeat(40_000),
      },
    ];

    const [bounded] = limitToolContextItemsForHistory(contextItems);

    expect(bounded.content.length).toBeLessThan(contextItems[0].content.length);
    expect(bounded.content).toContain("tool output truncated");
    expect(bounded.description).toContain("truncated for session history");
  });
});
