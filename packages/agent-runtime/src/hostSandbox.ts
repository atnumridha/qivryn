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

const warnedPlatforms = new Set<NodeJS.Platform>();

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  const pathValue = env.PATH ?? "";
  const extensions =
    process.platform === "win32"
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
): AgentProcessCommand {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? command.env ?? process.env;
  const exists = options.commandExists ?? commandExists;

  // Windows has no built-in equivalent to seatbelt/bubblewrap here.
  // Default to host execution so read-only runs still work without requiring
  // WSL/Docker/admin setup. Teams that require strict fail-closed behavior can
  // opt in via QIVRYN_REQUIRE_HOST_SANDBOX=true.
  if (platform === "win32") {
    const strictSandboxRequirement = isTruthy(env.QIVRYN_REQUIRE_HOST_SANDBOX);
    if (policy.required !== false && strictSandboxRequirement) {
      throw new Error(
        "Required host sandbox is unavailable on win32; disable strict mode or use Docker runtime",
      );
    }
    if (policy.required !== false && !warnedPlatforms.has(platform)) {
      warnedPlatforms.add(platform);
      console.warn(
        "Host sandbox is unavailable on win32; continuing without host sandbox restrictions",
      );
    }
    return command;
  }

  if (platform === "darwin" && exists("sandbox-exec", env)) {
    const profile = [
      "(version 1)",
      "(allow default)",
      ...(policy.network === "deny" ? ["(deny network*)"] : []),
      "(deny file-write*)",
    ].join(" ");
    return {
      ...command,
      command: "sandbox-exec",
      args: ["-p", profile, command.command, ...(command.args ?? [])],
    };
  }

  if (platform === "linux" && exists("bwrap", env)) {
    const cwd = command.cwd ?? process.cwd();
    return {
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
    };
  }

  if (policy.required !== false) {
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

  return command;
}
