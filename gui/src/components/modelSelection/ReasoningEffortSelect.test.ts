import { describe, expect, it } from "vitest";
import { formatReasoningEffort } from "./reasoningEffortLabels";

describe("formatReasoningEffort", () => {
  it.each([
    ["low", "Light"],
    ["medium", "Medium"],
    ["high", "High"],
    ["xhigh", "Extra High"],
    ["x-high", "Extra High"],
    ["max", "Ultra"],
    ["ultra", "Ultra"],
  ])("formats %s as %s", (value, label) => {
    expect(formatReasoningEffort(value)).toBe(label);
  });

  it("title-cases provider-specific values", () => {
    expect(formatReasoningEffort("very_high")).toBe("Very High");
  });
});
