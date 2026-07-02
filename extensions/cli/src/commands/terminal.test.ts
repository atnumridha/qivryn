import { describe, expect, it } from "vitest";
import { inspectTerminalCommand } from "./terminal.js";

describe("terminal inspect command", () => {
  it("uses the shared terminal classifier", () => {
    expect(inspectTerminalCommand("npm test", { sandbox: true })).toMatchObject(
      {
        policy: "allowedWithPermission",
        sandboxed: true,
        requiresNetwork: true,
        segments: [{ executable: "npm", args: ["test"] }],
      },
    );
    expect(
      inspectTerminalCommand("sudo rm -rf /", { sandbox: true }),
    ).toMatchObject({ policy: "disabled", sandboxed: false, elevated: true });
  });

  it("rejects unknown policies", () => {
    expect(() =>
      inspectTerminalCommand("echo ok", { policy: "anything" }),
    ).toThrow(/Unknown terminal policy/);
  });
});
