import type { AssistantUnrolled } from "@qivryn/config-yaml";
import { describe, expect, it } from "vitest";

import { removeLegacyDefaultRules } from "./removeLegacyDefaultRules.js";

const legacyRules = [
  "You are a precise software engineering assistant. Think carefully before making changes.",
  "Prefer minimal, targeted edits. Always explain your reasoning concisely.",
  "When using tools, be explicit about which file and line you are editing.",
];

const config = (rules?: AssistantUnrolled["rules"]): AssistantUnrolled => ({
  name: "Test",
  version: "1.0.0",
  rules,
});

describe("removeLegacyDefaultRules", () => {
  it("removes all known legacy defaults", () => {
    expect(removeLegacyDefaultRules(config(legacyRules)).rules).toEqual([]);
  });

  it("preserves custom string and structured rules", () => {
    const customRule = { name: "TypeScript", rule: "Use strict typing" };

    expect(
      removeLegacyDefaultRules(
        config([legacyRules[0], "Keep this custom rule", customRule]),
      ).rules,
    ).toEqual(["Keep this custom rule", customRule]);
  });

  it("does not mutate the original configuration", () => {
    const original = config([...legacyRules]);

    const result = removeLegacyDefaultRules(original);

    expect(result).not.toBe(original);
    expect(original.rules).toEqual(legacyRules);
  });

  it("returns configurations without rules unchanged", () => {
    const original = config();

    expect(removeLegacyDefaultRules(original)).toBe(original);
  });
});
