import { describe, expect, it, vi } from "vitest";
import { applyHostSandbox } from "../src/hostSandbox.js";

const policy = { filesystem: "read-only", network: "deny" } as const;
const connectedPolicy = {
  filesystem: "read-only",
  network: "allow",
} as const;

describe("applyHostSandbox", () => {
  it("wraps macOS commands with a deny-write and deny-network Seatbelt profile", () => {
    const resolution = applyHostSandbox(
      { command: "node", args: ["worker.js"], cwd: "/repo" },
      policy,
      { platform: "darwin", commandExists: () => true },
    );
    expect(resolution).toMatchObject({
      applied: true,
      enforced: true,
      mechanism: "sandbox-exec",
      command: {
        command: "sandbox-exec",
        cwd: "/repo",
        args: [
          "-p",
          expect.stringContaining("(deny network*)"),
          "node",
          "worker.js",
        ],
      },
    });
    expect(resolution.command.args?.[1]).toContain("(deny file-write*)");
  });

  it("wraps Linux commands with a read-only Bubblewrap root and no network", () => {
    const resolution = applyHostSandbox(
      { command: "node", args: ["worker.js"], cwd: "/repo" },
      policy,
      { platform: "linux", commandExists: () => true },
    );
    expect(resolution).toMatchObject({
      applied: true,
      enforced: true,
      mechanism: "bwrap",
    });
    expect(resolution.command.command).toBe("bwrap");
    expect(resolution.command.args).toEqual(
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

  it("keeps model transport available while denying writes on macOS", () => {
    const resolution = applyHostSandbox(
      { command: "node", args: ["worker.js"], cwd: "/repo" },
      connectedPolicy,
      { platform: "darwin", commandExists: () => true },
    );
    expect(resolution.command.args?.[1]).toContain("(deny file-write*)");
    expect(resolution.command.args?.[1]).not.toContain("(deny network*)");
  });

  it("keeps model transport available in a read-only Linux sandbox", () => {
    const resolution = applyHostSandbox(
      { command: "node", args: ["worker.js"], cwd: "/repo" },
      connectedPolicy,
      { platform: "linux", commandExists: () => true },
    );
    expect(resolution.command.args).toContain("--ro-bind");
    expect(resolution.command.args).not.toContain("--unshare-net");
  });

  it("reports an unenforced host fallback on Windows", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const command = { command: "node", args: ["worker.js"] };
    try {
      expect(
        applyHostSandbox(command, policy, {
          platform: "win32",
          commandExists: () => false,
        }),
      ).toEqual({
        command,
        applied: false,
        enforced: false,
        mechanism: "none",
        reason: "unsupported-platform",
      });
    } finally {
      warning.mockRestore();
    }
  });

  it("fails closed on Windows when the policy is explicitly required", () => {
    expect(() =>
      applyHostSandbox(
        { command: "node" },
        { ...policy, required: true },
        {
          platform: "win32",
          commandExists: () => false,
        },
      ),
    ).toThrow(/Required host sandbox is unavailable on win32/);
  });

  it("fails closed when the admin strict flag overrides an optional policy", () => {
    expect(() =>
      applyHostSandbox(
        { command: "node" },
        { ...policy, required: false },
        {
          platform: "win32",
          commandExists: () => false,
          env: { QIVRYN_REQUIRE_HOST_SANDBOX: "true" },
        },
      ),
    ).toThrow(/Required host sandbox is unavailable on win32/);
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
    ).toEqual({
      command,
      applied: false,
      enforced: false,
      mechanism: "none",
      reason: "launcher-unavailable",
    });
  });
});
