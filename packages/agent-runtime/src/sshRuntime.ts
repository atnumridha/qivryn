import type { AgentRun } from "./contracts.js";
import type { AgentProcessSpec } from "./processExecutor.js";

export interface SshRunOptions {
  host: string;
  remotePath: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  port?: number;
  identityFile?: string;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildSshRunSpec(
  run: AgentRun,
  options: SshRunOptions,
): AgentProcessSpec {
  if (
    options.host.startsWith("-") ||
    !/^[A-Za-z0-9._-]+(?:@[A-Za-z0-9._-]+)?$/.test(options.host)
  ) {
    throw new Error("SSH host must be a hostname or user@hostname");
  }
  if (
    !options.remotePath.startsWith("/") ||
    options.remotePath.includes("\0")
  ) {
    throw new Error("SSH remote path must be absolute");
  }
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535)
  ) {
    throw new Error("SSH port must be between 1 and 65535");
  }
  const command = options.command ?? "cn";
  if (!/^[A-Za-z0-9._/-]+$/.test(command))
    throw new Error("Unsafe SSH agent command");
  const remoteEnvironment = Object.entries(options.env ?? {}).map(
    ([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Unsafe SSH environment key: ${key}`);
      }
      return `${key}=${quote(value)}`;
    },
  );
  const remoteArgs = (
    options.args ?? [
      run.prompt,
      "--print",
      ...(run.permissionMode === "readOnly" ? ["--readonly"] : []),
      ...(run.permissionMode === "autonomous" ? ["--autonomous"] : []),
      ...(run.permissionMode === "fullAccess" ? ["--auto"] : []),
      ...(run.model ? ["--model", run.model] : []),
    ]
  ).map(quote);
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    ...(options.port ? ["-p", String(options.port)] : []),
    ...(options.identityFile ? ["-i", options.identityFile] : []),
    options.host,
    `cd ${quote(options.remotePath)} && ${
      remoteEnvironment.length ? `env ${remoteEnvironment.join(" ")} ` : ""
    }${quote(command)} ${remoteArgs.join(" ")}`,
  ];
  return { command: "ssh", args, cwd: process.cwd(), env: process.env };
}

export interface SshAttachmentTransfer {
  localPath: string;
  remotePath: string;
}

export function addSshAttachmentTransfers(
  spec: AgentProcessSpec,
  options: Pick<SshRunOptions, "host" | "port" | "identityFile">,
  remoteDirectory: string,
  transfers: readonly SshAttachmentTransfer[],
): AgentProcessSpec {
  if (!remoteDirectory.startsWith("/") || remoteDirectory.includes("\0")) {
    throw new Error("SSH attachment directory must be absolute");
  }
  if (transfers.length === 0) return spec;
  const sshConnectionArgs = [
    "-o",
    "BatchMode=yes",
    ...(options.port ? ["-p", String(options.port)] : []),
    ...(options.identityFile ? ["-i", options.identityFile] : []),
  ];
  const scpConnectionArgs = [
    "-o",
    "BatchMode=yes",
    ...(options.port ? ["-P", String(options.port)] : []),
    ...(options.identityFile ? ["-i", options.identityFile] : []),
  ];
  return {
    ...spec,
    setup: [
      {
        command: "ssh",
        args: [
          ...sshConnectionArgs,
          options.host,
          `mkdir -p -- ${quote(remoteDirectory)}`,
        ],
      },
      ...transfers.map((transfer) => ({
        command: "scp",
        args: [
          ...scpConnectionArgs,
          "--",
          transfer.localPath,
          `${options.host}:${transfer.remotePath}`,
        ],
      })),
    ],
    cleanup: [
      {
        command: "ssh",
        args: [
          ...sshConnectionArgs,
          options.host,
          `rm -rf -- ${quote(remoteDirectory)}`,
        ],
      },
    ],
  };
}
