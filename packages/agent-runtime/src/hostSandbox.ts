import fs from "node:fs";
import path from "node:path";
import type { AgentProcessCommand } from "./processExecutor.js";

export interface HostSandboxPolicy {
  filesystem: "read-only";
  network: "deny";
  required?: boolean;
}

export interface HostSandboxResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandExists?: (command: string, env: NodeJS.ProcessEnv) => boolean;
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

  if (platform === "darwin" && exists("sandbox-exec", env)) {
    return {
      ...command,
      command: "sandbox-exec",
      args: [
        "-p",
        "(version 1) (allow default) (deny network*) (deny file-write*)",
        command.command,
        ...(command.args ?? []),
      ],
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
        "--unshare-net",
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
