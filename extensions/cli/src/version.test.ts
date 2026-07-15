import { describe, expect, it } from "vitest";

import { extractLatestNpmVersion } from "./version.js";

describe("extractLatestNpmVersion", () => {
  it("returns the CLI version from npm metadata", () => {
    expect(extractLatestNpmVersion({ version: "1.3.46" })).toBe("1.3.46");
  });

  it("accepts a semantic prerelease version", () => {
    expect(extractLatestNpmVersion({ version: "1.3.46-beta.1" })).toBe(
      "1.3.46-beta.1",
    );
  });

  it.each([
    null,
    {},
    { version: 123 },
    { version: "latest" },
    { version: "1.3" },
    { version: "v1.3.46-vscode" },
  ])("returns null for invalid npm metadata %#", (metadata) => {
    expect(extractLatestNpmVersion(metadata)).toBeNull();
  });
});
