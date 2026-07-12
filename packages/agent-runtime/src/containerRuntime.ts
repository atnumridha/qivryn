import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentRun, AgentWorkspace } from "./contracts.js";
import {
  LocalAgentRuntime,
  type AgentExecutionContext,
  type AgentExecutionResult,
  type AgentWorkspaceProvider,
  type LocalAgentExecutor,
  type LocalAgentRuntimeOptions,
} from "./localRuntime.js";
import {
  ProcessAgentExecutor,
  type AgentProcessSpec,
} from "./processExecutor.js";
import type { AgentStore } from "./store.js";

const execFileAsync = promisify(execFile);

export interface DockerContainerMount {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface DockerContainerSpec {
  image: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  mounts?: DockerContainerMount[];
  network?: string;
  privileged?: boolean;
}

export interface DockerContainerRuntimeOptions
  extends LocalAgentRuntimeOptions {
  resolveContainer(
    run: AgentRun,
  ): Promise<DockerContainerSpec> | DockerContainerSpec;
  dockerCommand?: string;
  allowPrivileged?: boolean;
}

function containerName(runId: string): string {
  return `qivryn-agent-${runId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 48)}`;
}

export function buildDockerRunSpec(
  run: AgentRun,
  spec: DockerContainerSpec,
  options: Pick<
    DockerContainerRuntimeOptions,
    "dockerCommand" | "allowPrivileged"
  > = {},
): AgentProcessSpec {
  if (spec.privileged && !options.allowPrivileged) {
    throw new Error("Privileged containers require allowPrivileged=true");
  }
  const workspace = run.workspace.worktreePath ?? run.workspace.repositoryPath;
  const readOnly = run.permissionMode === "readOnly";
  const args = [
    "run",
    "--rm",
    "--name",
    containerName(run.id),
    "--workdir",
    "/workspace",
    "--volume",
    `${workspace}:/workspace${readOnly ? ":ro" : ""}`,
    "--network",
    spec.network ?? "bridge",
    "--env",
    `QIVRYN_PERMISSION_MODE=${run.permissionMode}`,
  ];
  for (const mount of spec.mounts ?? []) {
    if (!mount.source || mount.source.includes("\0")) {
      throw new Error("Docker mount sources must be non-empty paths");
    }
    if (!mount.target.startsWith("/") || mount.target.includes("\0")) {
      throw new Error("Docker mount targets must be absolute paths");
    }
    args.push(
      "--mount",
      `type=bind,source=${mount.source},target=${mount.target}${
        mount.readOnly ? ",readonly" : ""
      }`,
    );
  }
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Unsafe container environment key: ${key}`);
    }
    args.push("--env", `${key}=${value}`);
  }
  if (spec.privileged) args.push("--privileged");
  args.push(spec.image, spec.command, ...(spec.args ?? []));
  return {
    command: options.dockerCommand ?? "docker",
    args,
    cwd: workspace,
    env: process.env,
  };
}

export class DockerContainerAgentExecutor implements LocalAgentExecutor {
  private readonly processExecutor: ProcessAgentExecutor;

  constructor(private readonly options: DockerContainerRuntimeOptions) {
    this.processExecutor = new ProcessAgentExecutor({
      resolveProcess: async (run) =>
        buildDockerRunSpec(run, await options.resolveContainer(run), options),
    });
  }

  execute(
    run: AgentRun,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult | void> {
    return this.processExecutor.execute(run, context);
  }

  async cancel(run: AgentRun): Promise<void> {
    await this.processExecutor.cancel(run);
    try {
      await execFileAsync(
        this.options.dockerCommand ?? "docker",
        ["stop", "--time", "2", containerName(run.id)],
        { encoding: "utf8" },
      );
    } catch {
      // The container may have already exited and been removed.
    }
  }
}

class ContainerWorkspaceProvider implements AgentWorkspaceProvider {
  constructor(private readonly delegate: AgentWorkspaceProvider) {}

  async prepare(run: AgentRun): Promise<AgentWorkspace> {
    return { ...(await this.delegate.prepare(run)), location: "container" };
  }

  async cleanup(workspace: AgentWorkspace): Promise<void> {
    await this.delegate.cleanup?.(workspace);
  }

  async createCheckpoint(
    run: AgentRun,
    checkpoint: Parameters<
      NonNullable<AgentWorkspaceProvider["createCheckpoint"]>
    >[1],
  ) {
    return this.delegate.createCheckpoint?.(run, checkpoint);
  }

  async restoreCheckpoint(
    run: AgentRun,
    checkpoint: Parameters<
      NonNullable<AgentWorkspaceProvider["restoreCheckpoint"]>
    >[1],
  ): Promise<void> {
    await this.delegate.restoreCheckpoint?.(run, checkpoint);
  }
}

export function createDockerAgentRuntime(
  store: AgentStore,
  workspaceProvider: AgentWorkspaceProvider,
  options: DockerContainerRuntimeOptions,
): LocalAgentRuntime {
  return new LocalAgentRuntime(
    store,
    new DockerContainerAgentExecutor(options),
    new ContainerWorkspaceProvider(workspaceProvider),
    {
      ...options,
      runtimeId: options.runtimeId ?? "docker",
      capabilities: {
        local: false,
        remote: true,
        persistent: true,
        worktrees: true,
        checkpoints: true,
        browser: false,
        review: false,
        ...options.capabilities,
      },
    },
  );
}
