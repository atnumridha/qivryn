import { describe, expect, it } from "vitest";
import {
  generateCommitMessage,
  normalizeCommitMessage,
} from "../src/commitMessage.js";

describe("shared commit message generator", () => {
  const diff = "diff --git a/a.ts b/a.ts\n+const value = 1;\n";

  it("provides a local deterministic fallback", async () => {
    await expect(generateCommitMessage(diff)).resolves.toBe("Update a.ts");
  });

  it("normalizes provider output", async () => {
    await expect(
      generateCommitMessage(diff, async () => "```text\nAdd value\n```"),
    ).resolves.toBe("Add value");
    expect(normalizeCommitMessage("  Test  ")).toBe("Test");
  });
});
