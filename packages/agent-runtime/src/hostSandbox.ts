import fs from "node:fs";
import path from "node:path";
import type { AgentProcessCommand } from "./processExecutor.js";

export interface HostSandboxPolicy {
  filesystem: "read-only";
  network: "allow" | "deny";
  required?: boolean;
}

export interface HostSandboxResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandExists?: (command: string, env: NodeJS.ProcessEnv) => boolean;
}

export type HostSandboxMechanism = "sandbox-exec" | "bwrap" | "none";

export interface HostSandboxMetadata {
  applied: boolean;
  enforced: boolean;
  mechanism: HostSandboxMechanism;
  reason?: "unsupported-platform" | "launcher-unavailable";
}

export interface HostSandboxResolution extends HostSandboxMetadata {
  command: AgentProcessCommand;
}

export type HostSandboxResolver = (
  command: AgentProcessCommand,
  policy: HostSandboxPolicy,
) => HostSandboxResolution;

const warnedPlatforms = new Set<NodeJS.Platform>();

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function commandExists(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  const pathValue = env.PATH ?? "";
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  return pathValue.split(path.delimiter).some((directory) =>
    extensions.some((extension) => {
      try {
        fs.accessSync(
          path.join(directory, `${command}${extension}`),
          fs.constants.X_OK,
        );
        return true;
      } catch {
        return false;
      }
    }),
  );
}

export function applyHostSandbox(
  command: AgentProcessCommand,
  policy: HostSandboxPolicy,
  options: HostSandboxResolutionOptions = {},
): HostSandboxResolution {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? command.env ?? process.env;
  const exists =
    options.commandExists ??
    ((candidate: string, candidateEnv: NodeJS.ProcessEnv) =>
      commandExists(candidate, candidateEnv, platform));
  const required =
    isTruthy(env.QIVRYN_REQUIRE_HOST_SANDBOX) ||
    policy.required === true ||
    (policy.required === undefined && platform !== "win32");

  // Windows has no built-in equivalent to seatbelt/bubblewrap here.
  // Default to host execution so read-only runs still work without requiring
  // WSL/Docker/admin setup. Explicit required policies and the admin strict
  // environment flag fail closed.
  if (platform === "win32") {
    if (required) {
      throw new Error(
        "Required host sandbox is unavailable on win32; disable strict mode or use Docker runtime",
      );
    }
    if (!warnedPlatforms.has(platform)) {
      warnedPlatforms.add(platform);
      console.warn(
        "Host sandbox is unavailable on win32; continuing without host sandbox restrictions",
      );
    }
    return {
      command,
      applied: false,
      enforced: false,
      mechanism: "none",
      reason: "unsupported-platform",
    };
  }

  if (platform === "darwin" && exists("sandbox-exec", env)) {
    const profile = [
      "(version 1)",
      "(allow default)",
      ...(policy.network === "deny" ? ["(deny network*)"] : []),
      "(deny file-write*)",
    ].join(" ");
    return {
      command: {
        ...command,
        command: "sandbox-exec",
        args: ["-p", profile, command.command, ...(command.args ?? [])],
      },
      applied: true,
      enforced: true,
      mechanism: "sandbox-exec",
    };
  }

  if (platform === "linux" && exists("bwrap", env)) {
    const cwd = command.cwd ?? process.cwd();
    return {
      command: {
        ...command,
        command: "bwrap",
        args: [
          "--die-with-parent",
          "--new-session",
          ...(policy.network === "deny" ? ["--unshare-net"] : []),
          "--ro-bind",
          "/",
          "/",
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--tmpfs",
          "/tmp",
          "--chdir",
          cwd,
          "--",
          command.command,
          ...(command.args ?? []),
        ],
      },
      applied: true,
      enforced: true,
      mechanism: "bwrap",
    };
  }

  if (required) {
    const requirement =
      platform === "darwin"
        ? "sandbox-exec"
        : platform === "linux"
          ? "bwrap"
          : "a supported restricted-process launcher";
    throw new Error(
      `Required host sandbox is unavailable on ${platform}; install or enable ${requirement}, or use the Docker runtime`,
    );
  }

  return {
    command,
    applied: false,
    enforced: false,
    mechanism: "none",
    reason:
      platform === "darwin" || platform === "linux"
        ? "launcher-unavailable"
        : "unsupported-platform",
  };
}
