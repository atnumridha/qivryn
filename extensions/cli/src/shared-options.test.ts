import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { addCommonOptions } from "./shared-options.js";

describe("shared CLI options", () => {
  it("rejects agent-file policy overrides in readonly mode", () => {
    const command = addCommonOptions(new Command())
      .exitOverride()
      .configureOutput({ writeErr: () => undefined });

    expect(() =>
      command.parse(["node", "qivryn", "--readonly", "--agent", "reviewer"]),
    ).toThrowError(/cannot be used with option '--agent <slug>'/i);
  });
});
