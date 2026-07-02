import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Use the actual implementation instead of the mocked one
vi.unmock("./systemMessage.js");
const {
  buildBudgetedUserRulesContext,
  constructSystemMessage,
  isAlwaysAppliedRule,
  loadMarkdownRulesWithMetadata,
} = await import("./systemMessage.js");

// Mock the service container to avoid "No factory registered for service 'config'" error
vi.mock("./services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn().mockResolvedValue({ config: { rules: [] } }),
    set: vi.fn(),
  },
}));

// Mock processRule to avoid file system operations in tests
vi.mock("./hubLoader.js", () => ({
  processRule: vi
    .fn()
    .mockImplementation((spec: string) => Promise.resolve(spec)),
}));

const PLAN_MODE_STRING = "You are operating in _Plan Mode_";

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("constructSystemMessage", () => {
  it("budgets oversized always-applied rules without dropping all later rules", () => {
    const result = buildBudgetedUserRulesContext("Agent guidance", [
      "A".repeat(100_000),
      "Keep this later rule",
      "Keep this later rule",
    ]);

    expect(result.length).toBeLessThanOrEqual(60_000);
    expect(result).toContain("Rule compacted");
    expect(result).toContain("Keep this later rule");
    expect(result.match(/Keep this later rule/g)).toHaveLength(1);
  });
  it("should return base system message with rules when additionalRules is provided", async () => {
    const rules = ["These are the rules for the assistant."];
    const result = await constructSystemMessage("normal", rules);

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).toContain('<context name="userRules">');
    expect(result).toContain(rules[0]);
    expect(result).toContain("</context>");
  });

  it("should return base system message with agent content when no rules but agent file exists", async () => {
    // The implementation checks for agent files like AGENTS.md which exists in this project
    const result = await constructSystemMessage("normal");

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).toContain('<context name="userRules">');
    expect(result).toContain("AGENTS.md");
  });

  it("should include base system message components", async () => {
    const result = await constructSystemMessage("normal");

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).toContain("<env>");
    expect(result).toContain('<context name="gitStatus">');
  });

  it("should handle whitespace-only rules message", async () => {
    const result = await constructSystemMessage("normal", ["   "]);

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).toContain('<context name="userRules">');
  });

  it("should include working directory information", async () => {
    const result = await constructSystemMessage("normal");

    expect(result).toContain("Working directory:");
    expect(result).toContain("<env>");
  });

  it("should include platform information", async () => {
    const result = await constructSystemMessage("normal");

    expect(result).toContain("Platform:");
  });

  it("should include current date", async () => {
    const result = await constructSystemMessage("normal");

    expect(result).toContain("Today's date:");
    expect(result).toContain(new Date().toISOString().split("T")[0]);
  });

  it("should format rules section correctly", async () => {
    const rulesMessage = "Rule 1: Do this\nRule 2: Do that";
    const result = await constructSystemMessage("normal", [rulesMessage]);

    expect(result).toContain('<context name="userRules">');
    expect(result).toContain(rulesMessage);
    expect(result).toContain("</context>");
  });

  it("should handle multiline rules message", async () => {
    const rulesMessage = `Rule 1: First rule
Rule 2: Second rule
Rule 3: Third rule`;
    const result = await constructSystemMessage("normal", [rulesMessage]);

    expect(result).toContain(rulesMessage);
    expect(result).toContain('<context name="userRules">');
    expect(result).toContain("</context>");
  });

  it("should handle special characters in rules message", async () => {
    const rulesMessage = "Rule with <special> characters & symbols!";
    const result = await constructSystemMessage("normal", [rulesMessage]);

    expect(result).toContain(rulesMessage);
    expect(result).toContain('<context name="userRules">');
  });

  it("should handle very long rules message", async () => {
    const rulesMessage = "A".repeat(1000);
    const result = await constructSystemMessage("normal", [rulesMessage]);

    expect(result).toContain(rulesMessage);
    expect(result).toContain('<context name="userRules">');
  });

  it("should combine rules and agent content when both are present", async () => {
    const rulesMessage = "These are the rules.";
    const result = await constructSystemMessage("normal", [rulesMessage]);

    expect(result).toContain('<context name="userRules">');
    expect(result).toContain(rulesMessage);
    expect(result).toContain("AGENTS.md");
    expect(result).toContain("</context>");
  });

  it("should add headless mode instructions when headless is true", async () => {
    const result = await constructSystemMessage(
      "normal",
      undefined,
      undefined,
      true,
    );

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).toContain("IMPORTANT: You are running in headless mode");
    expect(result).toContain("Provide ONLY your final answer");
    expect(result).toContain(
      "Do not include explanations, reasoning, or additional commentary",
    );
  });

  it("should not add headless mode instructions when headless is false", async () => {
    const result = await constructSystemMessage(
      "normal",
      undefined,
      undefined,
      false,
    );

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).not.toContain("IMPORTANT: You are running in headless mode");
    expect(result).not.toContain("Provide ONLY your final answer");
  });

  it("should not add headless mode instructions when headless is undefined", async () => {
    const result = await constructSystemMessage("normal");

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).not.toContain("IMPORTANT: You are running in headless mode");
    expect(result).not.toContain("Provide ONLY your final answer");
  });

  it("should add JSON format instructions when format is json", async () => {
    const result = await constructSystemMessage("normal", undefined, "json");

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).toContain(
      "IMPORTANT: You are operating in JSON output mode",
    );
    expect(result).toContain("Your final response MUST be valid JSON");
    expect(result).toContain("JSON.parse()");
  });

  it("should add plan mode instructions when mode is plan", async () => {
    const result = await constructSystemMessage(
      "plan",
      undefined,
      undefined,
      false,
    );

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).toContain(PLAN_MODE_STRING);
    expect(result).toContain(
      "which means that your goal is to help the user investigate their ideas",
    );
    expect(result).toContain("develop a plan before taking action");
    expect(result).toContain("read-only tools");
    expect(result).toContain(
      "should not attempt to circumvent them to write / delete / create files",
    );
  });

  it("should not add plan mode instructions when mode is not plan", async () => {
    const result = await constructSystemMessage(
      "normal",
      undefined,
      undefined,
      false,
    );

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).not.toContain(PLAN_MODE_STRING);
    expect(result).not.toContain(
      "which means that your goal is to help the user investigate their ideas",
    );
  });

  it("should not add plan mode instructions when mode is normal", async () => {
    const result = await constructSystemMessage("normal");

    expect(result).toContain("You are an agent in the Continue CLI");
    expect(result).not.toContain(PLAN_MODE_STRING);
    expect(result).not.toContain(
      "which means that your goal is to help the user investigate their ideas",
    );
  });

  it("should include basic plan mode description", async () => {
    const result = await constructSystemMessage(
      "plan",
      undefined,
      undefined,
      false,
    );

    expect(result).toContain(PLAN_MODE_STRING);
    expect(result).toContain("read-only tools");
    expect(result).toContain("write / delete / create files");
  });

  it("should combine plan mode with headless mode instructions", async () => {
    const result = await constructSystemMessage(
      "plan",
      undefined,
      undefined,
      true,
    );

    expect(result).toContain("IMPORTANT: You are running in headless mode");
    expect(result).toContain(PLAN_MODE_STRING);
    expect(result).toContain(
      "which means that your goal is to help the user investigate their ideas",
    );
  });

  it("should combine plan mode with JSON format instructions", async () => {
    const result = await constructSystemMessage(
      "plan",
      undefined,
      "json",
      false,
    );

    expect(result).toContain(
      "IMPORTANT: You are operating in JSON output mode",
    );
    expect(result).toContain(PLAN_MODE_STRING);
    expect(result).toContain(
      "which means that your goal is to help the user investigate their ideas",
    );
  });
});

describe("loadMarkdownRulesWithMetadata", () => {
  it("loads portable rules across rule application modes", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "continue-rules-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "continue-home-"));
    tempDirs.push(cwd, home);

    const rulesDir = path.join(cwd, ".continue", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, "always.md"),
      "---\nname: Always Rule\nalwaysApply: true\n---\n\nAlways content",
    );
    fs.writeFileSync(
      path.join(rulesDir, "auto.md"),
      "---\nname: Auto Rule\nglobs: '**/*.ts'\nalwaysApply: false\n---\n\nAuto content",
    );
    fs.writeFileSync(
      path.join(rulesDir, "agent.md"),
      "---\nname: Agent Rule\ndescription: Use for migrations\nalwaysApply: false\n---\n\nAgent content",
    );
    fs.writeFileSync(
      path.join(rulesDir, "manual.md"),
      "---\nname: Manual Rule\nalwaysApply: false\n---\n\nManual content",
    );
    fs.writeFileSync(
      path.join(rulesDir, "prompt.md"),
      "---\nname: Prompt Rule\ninvokable: true\n---\n\nPrompt content",
    );

    const loadedRules = loadMarkdownRulesWithMetadata(cwd, home).filter(
      (rule) => rule.sourceFile?.startsWith(rulesDir),
    );

    expect(loadedRules.map((rule) => rule.name).sort()).toEqual([
      "Agent Rule",
      "Always Rule",
      "Auto Rule",
      "Manual Rule",
    ]);
    expect(
      isAlwaysAppliedRule(
        loadedRules.find((rule) => rule.name === "Always Rule")!,
      ),
    ).toBe(true);
    expect(
      isAlwaysAppliedRule(
        loadedRules.find((rule) => rule.name === "Auto Rule")!,
      ),
    ).toBe(false);
    expect(
      isAlwaysAppliedRule(
        loadedRules.find((rule) => rule.name === "Agent Rule")!,
      ),
    ).toBe(false);
    expect(
      isAlwaysAppliedRule(
        loadedRules.find((rule) => rule.name === "Manual Rule")!,
      ),
    ).toBe(false);
  });
});
