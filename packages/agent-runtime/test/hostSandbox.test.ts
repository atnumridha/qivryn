import { describe, expect, it } from "vitest";
import { applyHostSandbox } from "../src/hostSandbox.js";

const policy = { filesystem: "read-only", network: "deny" } as const;

describe("applyHostSandbox", () => {
  it("wraps macOS commands with a deny-write and deny-network Seatbelt profile", () => {
    const command = applyHostSandbox(
      { command: "node", args: ["worker.js"], cwd: "/repo" },
      policy,
      { platform: "darwin", commandExists: () => true },
    );
    expect(command).toMatchObject({
      command: "sandbox-exec",
      cwd: "/repo",
      args: [
        "-p",
        expect.stringContaining("(deny network*)"),
        "node",
        "worker.js",
      ],
    });
    expect(command.args?.[1]).toContain("(deny file-write*)");
  });

  it("wraps Linux commands with a read-only Bubblewrap root and no network", () => {
    const command = applyHostSandbox(
      { command: "node", args: ["worker.js"], cwd: "/repo" },
      policy,
      { platform: "linux", commandExists: () => true },
    );
    expect(command.command).toBe("bwrap");
    expect(command.args).toEqual(
      expect.arrayContaining([
        "--unshare-net",
        "--ro-bind",
        "/",
        "--tmpfs",
        "/tmp",
        "--chdir",
        "/repo",
        "--",
        "node",
        "worker.js",
      ]),
    );
  });

  it("fails closed when a required host sandbox is unavailable", () => {
    expect(() =>
      applyHostSandbox({ command: "node" }, policy, {
        platform: "win32",
        commandExists: () => false,
      }),
    ).toThrow(/Required host sandbox is unavailable/);
  });

  it("allows an explicit optional policy to fall back to the host", () => {
    const command = { command: "node", args: ["worker.js"] };
    expect(
      applyHostSandbox(
        command,
        { ...policy, required: false },
        {
          platform: "linux",
          commandExists: () => false,
        },
      ),
    ).toEqual(command);
  });
});
