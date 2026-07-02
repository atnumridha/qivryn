import { describe, expect, it } from "vitest";

import {
  compactToolArgumentsForContext,
  truncateTextForContext,
} from "./contextBudget.js";

describe("context budget", () => {
  it("preserves the beginning and end of oversized tool output", () => {
    const value = `START-${"x".repeat(200)}-END`;
    const compacted = truncateTextForContext(value, 120);

    expect(compacted.length).toBeLessThanOrEqual(120);
    expect(compacted).toContain("START-");
    expect(compacted).toContain("-END");
    expect(compacted).toContain("Context compacted");
  });

  it("keeps compacted tool arguments valid JSON", () => {
    const compacted = compactToolArgumentsForContext(
      JSON.stringify({ patch: "x".repeat(500) }),
      360,
    );

    expect(compacted.length).toBeLessThanOrEqual(360);
    expect(JSON.parse(compacted)).toMatchObject({ context_compacted: true });
  });
});
