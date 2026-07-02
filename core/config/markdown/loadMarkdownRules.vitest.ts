import { markdownToRule } from "@continuedev/config-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDE } from "../..";
import { getAllDotContinueDefinitionFiles } from "../loadLocalAssistants";
import { loadMarkdownRules } from "./loadMarkdownRules";

vi.mock("@continuedev/config-yaml", () => ({
  markdownToRule: vi.fn(),
}));

vi.mock("../loadLocalAssistants", () => ({
  getAllDotContinueDefinitionFiles: vi.fn(),
}));

describe("loadMarkdownRules", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (getAllDotContinueDefinitionFiles as any).mockResolvedValue([]);
    (markdownToRule as any).mockImplementation((content: string) => ({
      name: "Agent guidance",
      rule: content,
    }));
  });

  it("continues checking supported agent files until it finds CODEX.md", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace"]),
      fileExists: vi.fn((uri: string) =>
        Promise.resolve(uri === "file:///workspace/CODEX.md"),
      ),
      readFile: vi
        .fn()
        .mockResolvedValue("# Agent guidance\n\nUse durable project rules."),
    } as unknown as IDE;

    const { rules, errors } = await loadMarkdownRules(mockIde);

    expect(errors).toEqual([]);
    expect(mockIde.fileExists).toHaveBeenCalledWith(
      "file:///workspace/AGENTS.md",
    );
    expect(mockIde.fileExists).toHaveBeenCalledWith(
      "file:///workspace/AGENT.md",
    );
    expect(mockIde.fileExists).toHaveBeenCalledWith(
      "file:///workspace/CLAUDE.md",
    );
    expect(mockIde.fileExists).toHaveBeenCalledWith(
      "file:///workspace/CODEX.md",
    );
    expect(mockIde.readFile).toHaveBeenCalledWith("file:///workspace/CODEX.md");
    expect(rules).toEqual([
      {
        name: "Agent guidance",
        rule: "# Agent guidance\n\nUse durable project rules.",
        source: "agentFile",
        sourceFile: "file:///workspace/CODEX.md",
        alwaysApply: true,
      },
    ]);
  });
});
