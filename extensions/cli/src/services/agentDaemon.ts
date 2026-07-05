import {
  AGENT_DAEMON_PROTOCOL_VERSION,
  AgentDaemonServer,
  AgentHookRunner,
  FileAgentAutomationStore,
  FileAgentHookRegistry,
  FileAgentStore,
  FileAttributionStore,
  GitWorktreeWorkspaceProvider,
  HttpAgentRuntimeClient,
  LocalAgentRuntime,
  ProcessAgentExecutor,
  addSshAttachmentTransfers,
  buildDockerRunSpec,
  buildSshRunSpec,
  captureAgentAttributions,
  readAgentDaemonDescriptor as readSharedAgentDaemonDescriptor,
  startAgentAutomationScheduler,
  type AgentDaemonDescriptor,
  type AgentWorkspaceProvider,
} from "@qivryn/agent-runtime";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";
import {
  buildAgentChatArgs,
  executionImageNamesForAgentRun,
  imagePathsForAgentRun,
} from "./agentProcessArgs.js";

const agentRoot = path.join(env.qivrynHome, "agents");
const descriptorPath = path.join(agentRoot, "daemon.json");

function cliEntrypoint(): string {
  const entrypoint = process.env.QIVRYN_CLI_PATH || process.argv[1];
  if (!entrypoint) {
    throw new Error(
      "Unable to resolve the Qivryn CLI entrypoint for agent execution",
    );
  }
  return entrypoint;
}

function cliEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...extra,
  };
}

export async function readAgentDaemonDescriptor(): Promise<
  AgentDaemonDescriptor | undefined
> {
  return readSharedAgentDaemonDescriptor(descriptorPath);
}

function clientFor(descriptor: AgentDaemonDescriptor) {
  return new HttpAgentRuntimeClient({
    baseUrl: descriptor.baseUrl,
    token: descriptor.token,
  });
}

async function healthy(descriptor: AgentDaemonDescriptor): Promise<boolean> {
  try {
    await clientFor(descriptor).initialize();
    return true;
  } catch {
    return false;
  }
}

export async function ensureAgentDaemon(): Promise<HttpAgentRuntimeClient> {
  const existing = await readAgentDaemonDescriptor();
  if (
    existing?.protocolVersion === AGENT_DAEMON_PROTOCOL_VERSION &&
    (await healthy(existing))
  ) {
    return clientFor(existing);
  }
  if (existing && (await healthy(existing))) {
    try {
      process.kill(existing.pid, "SIGTERM");
    } catch {
      // The descriptor may be stale; the replacement below is still safe.
    }
  }
  await rm(descriptorPath, { force: true });
  await mkdir(agentRoot, { recursive: true });
  const token = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, [cliEntrypoint(), "agents", "daemon"], {
    detached: true,
    stdio: "ignore",
    env: cliEnv({ QIVRYN_AGENT_DAEMON_TOKEN: token }),
  });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    const descriptor = await readAgentDaemonDescriptor();
    if (
      descriptor &&
      descriptor.token === token &&
      (await healthy(descriptor))
    ) {
      return clientFor(descriptor);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out starting the local agent daemon");
}

export async function runAgentDaemon(): Promise<void> {
  const token = process.env.QIVRYN_AGENT_DAEMON_TOKEN;
  if (!token) throw new Error("Agent daemon token is missing");
  const store = new FileAgentStore(agentRoot);
  const attributionStore = new FileAttributionStore(
    path.join(env.qivrynHome, "attributions"),
  );
  await attributionStore.initialize();
  const worktrees = new GitWorktreeWorkspaceProvider({
    rootDirectory: path.join(agentRoot, "worktrees"),
  });
  const workspaces: AgentWorkspaceProvider = {
    prepare: (run) =>
      run.runtimeId === "ssh"
        ? Promise.resolve({ ...run.workspace, location: "ssh" as const })
        : worktrees.prepare(run),
    cleanup: (workspace) =>
      workspace.location === "ssh"
        ? Promise.resolve()
        : worktrees.cleanup(workspace),
    createCheckpoint: (run, checkpoint) =>
      run.runtimeId === "ssh"
        ? Promise.resolve()
        : worktrees.createCheckpoint(run, checkpoint),
    restoreCheckpoint: (run, checkpoint) => {
      if (run.runtimeId === "ssh") {
        throw new Error("SSH runs do not expose local Git checkpoints");
      }
      return worktrees.restoreCheckpoint(run, checkpoint);
    },
  };
  const hookRegistry = new FileAgentHookRegistry(
    path.join(env.qivrynHome, "hooks.json"),
  );
  const hooks = new AgentHookRunner(() => hookRegistry.list());
  const executor = new ProcessAgentExecutor({
    hooks,
    stdoutEventKind: "message.assistant",
    stdoutProtocol: "qivryn-agent-events",
    resolveProcess: (run) => {
      const localImagePaths = imagePathsForAgentRun(run);
      const imageNames = executionImageNamesForAgentRun(run);
      if (run.runtimeId === "docker") {
        const containerImagePaths = imageNames.map(
          (name) => `/qivryn-attachments/${name}`,
        );
        const chatArgs = buildAgentChatArgs(run, containerImagePaths);
        const container = (run.metadata?.container ?? {}) as {
          image?: string;
          network?: string;
          privileged?: boolean;
        };
        return buildDockerRunSpec(
          run,
          {
            image: container.image ?? "qivryn-agent:latest",
            command: "qivryn",
            args: chatArgs,
            mounts: localImagePaths.map((source, index) => ({
              source,
              target: containerImagePaths[index],
              readOnly: true,
            })),
            network: container.network,
            privileged: container.privileged,
            env: { QIVRYN_AGENT_EVENT_STREAM: "1" },
          },
          { allowPrivileged: container.privileged === true },
        );
      }
      if (run.runtimeId === "ssh") {
        const ssh = (run.metadata?.ssh ?? {}) as {
          host?: string;
          remotePath?: string;
          port?: number;
          identityFile?: string;
        };
        if (!ssh.host || !ssh.remotePath) {
          throw new Error("SSH runs require a host and remote path");
        }
        const attachmentDirectory = `/tmp/qivryn-agent-${run.id.replace(
          /[^a-zA-Z0-9_.-]/g,
          "-",
        )}-attachments`;
        const remoteImagePaths = imageNames.map(
          (name) => `${attachmentDirectory}/${name}`,
        );
        const options = {
          host: ssh.host,
          remotePath: ssh.remotePath,
          port: ssh.port,
          identityFile: ssh.identityFile,
          args: buildAgentChatArgs(run, remoteImagePaths),
          env: { QIVRYN_AGENT_EVENT_STREAM: "1" },
        };
        const spec = buildSshRunSpec(run, options);
        return addSshAttachmentTransfers(
          spec,
          options,
          attachmentDirectory,
          localImagePaths.map((localPath, index) => ({
            localPath,
            remotePath: remoteImagePaths[index],
          })),
        );
      }
      const chatArgs = buildAgentChatArgs(run, localImagePaths);
      return {
        command: process.execPath,
        args: [cliEntrypoint(), ...chatArgs],
        env: cliEnv({
          QIVRYN_AGENT_CHILD: "1",
          QIVRYN_AGENT_EVENT_STREAM: "1",
        }),
        ...(run.permissionMode === "readOnly"
          ? {
              hostSandbox: {
                filesystem: "read-only" as const,
                network: "deny" as const,
              },
            }
          : {}),
      };
    },
  });
  const runtime = new LocalAgentRuntime(store, executor, workspaces, {
    hooks,
    onRunFinished: (run) =>
      captureAgentAttributions(run, attributionStore, store).then(
        () => undefined,
      ),
  });
  const automationStore = new FileAgentAutomationStore(agentRoot);
  await automationStore.initialize();
  const stopAutomations = startAgentAutomationScheduler(
    automationStore,
    runtime,
  );
  const server = new AgentDaemonServer(runtime, { token });
  const address = await server.start();
  const descriptor: AgentDaemonDescriptor = {
    baseUrl: address.baseUrl,
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    protocolVersion: AGENT_DAEMON_PROTOCOL_VERSION,
  };
  await mkdir(agentRoot, { recursive: true });
  const temporary = `${descriptorPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, descriptorPath);

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  stopAutomations();
  await server.close();
  const current = await readAgentDaemonDescriptor();
  if (current?.pid === process.pid) await rm(descriptorPath, { force: true });
}
