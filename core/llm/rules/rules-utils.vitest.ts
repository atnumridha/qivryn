import { describe, expect, it } from "vitest";
import { getRuleDisplayName, getRuleSourceDisplayName } from "./rules-utils";

describe("rules-utils", () => {
  it("derives display names from rule headings", () => {
    expect(
      getRuleDisplayName({
        source: "rules-block",
        rule: "# Engineering Standards\n\n- Validate meaningful changes.",
      } as any),
    ).toBe("Engineering Standards");
  });

  it("derives display names from inline rule content", () => {
    expect(
      getRuleDisplayName({
        source: "rules-block",
        rule: "You are a precise software engineering assistant. Think carefully.",
      } as any),
    ).toBe("You are a precise software engineering assistant.");
  });

  it("uses a readable fallback for unnamed inline rules", () => {
    expect(
      getRuleSourceDisplayName({ source: "rules-block", rule: "" } as any),
    ).toBe("Inline rule");
  });

  it("keeps explicit names for built-in system messages", () => {
    expect(
      getRuleDisplayName({
        source: "default-agent",
        rule: "<important_rules>\n  You are an agent.\n</important_rules>",
      } as any),
    ).toBe("Default agent system message");
  });
});
