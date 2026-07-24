import { describe, expect, it } from "vitest";

import { compileChatMessages } from "./countTokens.js";
import { Tool } from "../index.js";
import { compactToolsForPrompt } from "../tools/compactToolsForPrompt.js";

describe("compactToolsForPrompt", () => {
  it("reduces real compiled input tokens while preserving tool shape", () => {
    const verboseDescription = Array.from({ length: 120 }, (_, index) => {
      return `verbose-description-${index}`;
    }).join(" ");
    const verboseTools: Tool[] = [
      {
        type: "function",
        displayTitle: "Verbose Tool",
        group: "test",
        readonly: true,
        function: {
          name: "verbose_tool",
          description: verboseDescription,
          parameters: {
            type: "object",
            required: ["path"],
            properties: {
              path: {
                type: "string",
                description: verboseDescription,
              },
            },
          },
        },
      },
    ];

    const compactTools = compactToolsForPrompt(verboseTools);
    expect(compactTools).toBeDefined();
    const compactTool = compactTools![0];
    expect(compactTool.function.name).toBe("verbose_tool");
    expect(compactTool.function.parameters?.required).toEqual(["path"]);
    expect(compactTool.function.description!.length).toBeLessThan(
      verboseDescription.length,
    );

    const compiledWithVerboseTool = compileChatMessages({
      modelName: "gpt-4",
      msgs: [{ role: "user", content: "Review the workspace" }],
      knownContextLength: 200_000,
      maxTokens: 64_000,
      supportsImages: true,
      tools: verboseTools,
    });
    const compiledWithCompactTool = compileChatMessages({
      modelName: "gpt-4",
      msgs: [{ role: "user", content: "Review the workspace" }],
      knownContextLength: 200_000,
      maxTokens: 64_000,
      supportsImages: true,
      tools: compactTools,
    });

    expect(compiledWithCompactTool.inputTokens!).toBeLessThan(
      compiledWithVerboseTool.inputTokens!,
    );
  });
});
