import {
  AgentControlService,
  createAgentDiagnosticReport,
  FileAgentStore,
  FileAgentAutomationStore,
  filterAgentRuns,
  formatAgentRunStatus,
  formatQivrynDeepLink,
  GitWorktreeWorkspaceProvider,
  type AgentRun,
  runAgentAutomation,
} from "@qivryn/agent-runtime";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { env } from "../env.js";
import { ensureAgentDaemon, runAgentDaemon } from "../services/agentDaemon.js";

interface AgentsCommandOptions {
  json?: boolean;
  all?: boolean;
  search?: string;
  events?: boolean;
  title?: string;
  prompt?: string;
  item?: string;
  behavior?: "run-next" | "steer";
  items?: string[];
  label?: string;
  repo?: string;
  model?: string;
  permissionMode?: "ask" | "autonomous" | "fullAccess" | "readOnly";
  detach?: boolean;
  parentRun?: string;
  steps?: string[];
  planStatus?: "draft" | "approved" | "rejected" | "completed";
  runtime?: "local" | "docker" | "ssh";
  image?: string;
  network?: string;
  privileged?: boolean;
  file?: string;
  branch?: string;
  sshHost?: string;
  sshPath?: string;
  sshPort?: string;
  identityFile?: string;
  name?: string;
  intervalMinutes?: string;
  skill?: string;
}

function createAgentStore(): FileAgentStore {
  return new FileAgentStore(path.join(env.qivrynHome, "agents"));
}

function formatRun(run: AgentRun): string {
  const diff =
    run.diffAdded || run.diffRemoved
      ? ` +${run.diffAdded ?? 0}/-${run.diffRemoved ?? 0}`
      : "";
  const workspace = run.workspace.worktreePath ?? run.workspace.repositoryPath;
  return `${run.id}\t${formatAgentRunStatus(run.status)}\t${run.title}${diff}\t${workspace}`;
}

export async function agentsCommand(
  action: string | undefined,
  runId: string | undefined,
  options: AgentsCommandOptions,
): Promise<void> {
  const store = createAgentStore();
  await store.initialize();
  const worktrees = new GitWorktreeWorkspaceProvider();
  const controls = new AgentControlService(store, {
    createCheckpoint: (run, checkpoint) =>
      worktrees.createCheckpoint(run, checkpoint),
    restoreCheckpoint: (run, checkpoint) =>
      worktrees.restoreCheckpoint(run, checkpoint),
  });

  const automationStore = new FileAgentAutomationStore(
    path.join(env.qivrynHome, "agents"),
  );
  await automationStore.initialize();

  if (action === "automation-list") {
    const automations = await automationStore.list();
    if (options.json) console.log(JSON.stringify({ automations }, null, 2));
    else {
      console.log("ID\tENABLED\tTRIGGER\tNAME\tREPOSITORY");
      for (const item of automations) {
        const trigger =
          item.trigger.type === "interval"
            ? `every ${item.trigger.everyMinutes}m`
            : "manual";
        console.log(
          `${item.id}\t${item.enabled}\t${trigger}\t${item.name}\t${item.repositoryPath}`,
        );
      }
    }
    return;
  }

  if (action === "automation-create") {
    if (!options.name || !options.prompt) {
      throw new Error("--name and --prompt are required");
    }
    const minutes = options.intervalMinutes
      ? Number(options.intervalMinutes)
      : undefined;
    if (
      options.intervalMinutes !== undefined &&
      (!Number.isFinite(minutes) || minutes! <= 0)
    ) {
      throw new Error("--interval-minutes must be greater than zero");
    }
    const automation = await automationStore.create({
      name: options.name,
      prompt: options.prompt,
      repositoryPath: path.resolve(options.repo ?? process.cwd()),
      model: options.model,
      permissionMode: options.permissionMode,
      runtimeId: options.runtime,
      trigger:
        minutes !== undefined
          ? { type: "interval", everyMinutes: minutes }
          : { type: "manual" },
    });
    console.log(
      options.json ? JSON.stringify({ automation }, null, 2) : automation.id,
    );
    return;
  }

  if (
    action === "automation-run" ||
    action === "automation-delete" ||
    action === "automation-enable" ||
    action === "automation-disable"
  ) {
    if (!runId) throw new Error(`Automation ID is required for ${action}`);
    if (action === "automation-delete") {
      await automationStore.remove(runId);
      if (options.json) console.log(JSON.stringify({ removed: runId }));
      return;
    }
    if (action === "automation-enable" || action === "automation-disable") {
      const automation = await automationStore.setEnabled(
        runId,
        action === "automation-enable",
      );
      console.log(
        options.json
          ? JSON.stringify({ automation }, null, 2)
          : `${automation.id}\t${automation.enabled}`,
      );
      return;
    }
    const automation = await automationStore.get(runId);
    if (!automation) throw new Error(`Automation ${runId} was not found`);
    const runtime = await ensureAgentDaemon();
    const run = await runAgentAutomation(automation, runtime);
    await automationStore.markRun(automation.id, run);
    console.log(
      options.json ? JSON.stringify({ run }, null, 2) : formatRun(run),
    );
    return;
  }

  if (action === "daemon") {
    await runAgentDaemon();
    return;
  }

  if (action === "diagnostics") {
    const report = await createAgentDiagnosticReport(store);
    const outputPath = path.resolve(
      options.file ?? `qivryn-agent-diagnostics-${Date.now()}.json`,
    );
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      options.json
        ? JSON.stringify({ output: outputPath, report }, null, 2)
        : outputPath,
    );
    return;
  }

  if (action === "start") {
    if (!options.prompt) throw new Error("--prompt is required");
    const repositoryPath = path.resolve(options.repo ?? process.cwd());
    const mode = options.permissionMode ?? "autonomous";
    const runtimeId = options.runtime ?? "local";
    if (runtimeId === "docker" && options.privileged && mode !== "fullAccess") {
      throw new Error("--privileged requires --permission-mode fullAccess");
    }
    if (runtimeId === "ssh" && (!options.sshHost || !options.sshPath)) {
      throw new Error("SSH runtime requires --ssh-host and --ssh-path");
    }
    const runtime = await ensureAgentDaemon();
    const run = await runtime.createRun({
      prompt: options.prompt,
      model: options.model,
      permissionMode: mode,
      parentRunId: options.parentRun,
      runtimeId,
      workspace: {
        location:
          runtimeId === "docker"
            ? "container"
            : runtimeId === "ssh"
              ? "ssh"
              : "local",
        repositoryPath: runtimeId === "ssh" ? options.sshPath! : repositoryPath,
      },
      metadata:
        runtimeId === "docker"
          ? {
              container: {
                image: options.image ?? "qivryn-agent:latest",
                network: options.network ?? "bridge",
                privileged: options.privileged ?? false,
              },
            }
          : runtimeId === "ssh"
            ? {
                ssh: {
                  host: options.sshHost,
                  remotePath: options.sshPath,
                  port: options.sshPort ? Number(options.sshPort) : undefined,
                  identityFile: options.identityFile,
                },
              }
            : undefined,
    });
    if (options.detach) {
      console.log(
        options.json ? JSON.stringify({ run }, null, 2) : formatRun(run),
      );
      return;
    }
    const cancel = () => void runtime.cancelRun(run.id, "client-signal");
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    for await (const event of runtime.streamEvents(run.id)) {
      if (event.kind === "tool.output") {
        const payload = event.payload as { channel?: string; text?: string };
        if (payload.text) process.stderr.write(payload.text);
      }
    }
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    const completed = await runtime.getRun(run.id);
    if (!completed) throw new Error(`Agent run ${run.id} disappeared`);
    console.log(
      options.json
        ? JSON.stringify({ run: completed }, null, 2)
        : formatRun(completed),
    );
    if (completed.status === "failed") process.exitCode = 1;
    return;
  }

  if (action === "multitask") {
    const tasks =
      options.items?.map((item) => item.trim()).filter(Boolean) ?? [];
    if (!tasks.length)
      throw new Error("--items requires at least one quoted task");
    const runtime = await ensureAgentDaemon();
    const repositoryPath = path.resolve(options.repo ?? process.cwd());
    const runs = await Promise.all(
      tasks.slice(0, 12).map((task) =>
        runtime.createRun({
          prompt: options.skill
            ? `Use the ${JSON.stringify(options.skill)} skill for this task.\n\n${task}`
            : task,
          model: options.model,
          permissionMode: options.permissionMode ?? "autonomous",
          runtimeId: "local",
          workspace: { location: "local", repositoryPath },
        }),
      ),
    );
    if (options.json) console.log(JSON.stringify({ runs }, null, 2));
    else for (const run of runs) console.log(formatRun(run));
    return;
  }

  if (action === "export") {
    if (!runId || !options.file) {
      throw new Error("Run ID and --file are required for export");
    }
    const runtime = await ensureAgentDaemon();
    const snapshot = await runtime.exportRun(runId);
    const outputPath = path.resolve(options.file);
    await writeFile(
      outputPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    console.log(
      options.json ? JSON.stringify({ output: outputPath }) : outputPath,
    );
    return;
  }

  if (action === "import") {
    if (!options.file) throw new Error("--file is required for import");
    const snapshot = JSON.parse(
      await readFile(path.resolve(options.file), "utf8"),
    );
    const runtime = await ensureAgentDaemon();
    const imported = await runtime.importRun(snapshot, {
      ...(options.repo ? { repositoryPath: path.resolve(options.repo) } : {}),
      ...(options.runtime === "docker"
        ? { location: "container" as const }
        : {}),
    });
    console.log(
      options.json
        ? JSON.stringify({ run: imported }, null, 2)
        : formatRun(imported),
    );
    return;
  }

  if (action === "ingest") {
    if (!runId || !options.file) {
      throw new Error("Run ID and --file are required for NDJSON ingest");
    }
    const events = (await readFile(path.resolve(options.file), "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const runtime = await ensureAgentDaemon();
    const appended = await runtime.ingestEvents(runId, events);
    console.log(
      options.json
        ? JSON.stringify({ events: appended }, null, 2)
        : `${appended.length} events ingested`,
    );
    return;
  }

  if (
    action === "worktree-retain" ||
    action === "worktree-release" ||
    action === "worktree-rename" ||
    action === "worktree-export" ||
    action === "worktree-merge"
  ) {
    if (!runId)
      throw new Error(`Run ID is required: qivryn agents ${action} <run-id>`);
    const runtime = await ensureAgentDaemon();
    if (action === "worktree-retain" || action === "worktree-release") {
      const result = await runtime.retainWorktree(
        runId,
        action === "worktree-retain",
      );
      console.log(
        options.json ? JSON.stringify(result, null, 2) : formatRun(result.run),
      );
      return;
    }
    if (action === "worktree-rename") {
      if (!options.branch) throw new Error("--branch is required");
      const result = await runtime.renameWorktree(runId, options.branch);
      console.log(
        options.json ? JSON.stringify(result, null, 2) : formatRun(result.run),
      );
      return;
    }
    if (action === "worktree-export") {
      if (!options.file) throw new Error("--file is required");
      const result = await runtime.exportWorktreePatch(runId);
      const outputPath = path.resolve(options.file);
      await writeFile(outputPath, result.patch ?? "", "utf8");
      console.log(
        options.json
          ? JSON.stringify({ output: outputPath }, null, 2)
          : outputPath,
      );
      return;
    }
    const result = await runtime.mergeWorktree(runId);
    console.log(
      options.json
        ? JSON.stringify(result, null, 2)
        : `Merged ${result.run.workspace.branch} into ${result.mergedInto} at ${result.commit}`,
    );
    return;
  }

  if (
    action === "cancel" ||
    action === "resume" ||
    action === "duplicate" ||
    action === "cleanup"
  ) {
    if (!runId)
      throw new Error(`Run ID is required: qivryn agents ${action} <run-id>`);
    const runtime = await ensureAgentDaemon();
    if (action === "cleanup") {
      await runtime.cleanupRun(runId);
      if (options.json) console.log(JSON.stringify({ cleaned: runId }));
      return;
    }
    const run =
      action === "cancel"
        ? await runtime.cancelRun(runId)
        : action === "resume"
          ? await runtime.resumeRun(runId)
          : await runtime.duplicateRun(runId, options.title);
    console.log(
      options.json ? JSON.stringify({ run }, null, 2) : formatRun(run),
    );
    return;
  }

  if (!action || action === "list") {
    const runs = filterAgentRuns(
      await store.listRuns({
        includeArchived: options.all,
        limit: options.all ? undefined : 100,
      }),
      options.search,
    );
    if (options.json) {
      console.log(JSON.stringify({ runs }, null, 2));
      return;
    }
    if (runs.length === 0) {
      console.log("No agent runs found.");
      return;
    }
    console.log("ID\tSTATUS\tTITLE\tWORKSPACE");
    for (const run of runs) {
      console.log(formatRun(run));
    }
    return;
  }

  if (action === "show") {
    if (!runId) {
      throw new Error("Run ID is required: qivryn agents show <run-id>");
    }
    const run = await store.getRun(runId);
    if (!run) {
      throw new Error(`Agent run ${runId} was not found`);
    }
    const events = options.events ? await store.readEvents(runId) : undefined;
    if (options.json) {
      console.log(JSON.stringify({ run, events }, null, 2));
      return;
    }
    console.log(formatRun(run));
    if (events) {
      for (const event of events) {
        console.log(`${event.sequence}\t${event.kind}\t${event.createdAt}`);
      }
    }
    return;
  }

  if (!runId) {
    throw new Error(`Run ID is required: qivryn agents ${action} <run-id>`);
  }

  if (action === "rename") {
    if (!options.title) throw new Error("--title is required");
    const run = await controls.renameRun(runId, options.title);
    console.log(
      options.json ? JSON.stringify({ run }, null, 2) : formatRun(run),
    );
    return;
  }

  if (action === "link") {
    console.log(
      formatQivrynDeepLink(
        options.item
          ? { type: "checkpoint", runId, checkpointId: options.item }
          : { type: "agent", runId },
      ),
    );
    return;
  }

  if (action === "pin" || action === "unpin") {
    const run = await controls.setRunPinned(runId, action === "pin");
    console.log(
      options.json ? JSON.stringify({ run }, null, 2) : formatRun(run),
    );
    return;
  }

  if (action === "archive") {
    const run = await controls.archiveRun(runId);
    console.log(
      options.json ? JSON.stringify({ run }, null, 2) : formatRun(run),
    );
    return;
  }

  if (action === "queue") {
    if (!options.prompt) throw new Error("--prompt is required");
    const item = await controls.enqueuePrompt(
      runId,
      options.prompt,
      options.behavior,
    );
    console.log(options.json ? JSON.stringify({ item }, null, 2) : item.id);
    return;
  }

  if (action === "queue-list") {
    const queue = await controls.listQueue(runId);
    if (options.json) console.log(JSON.stringify({ queue }, null, 2));
    else
      queue.forEach((item) =>
        console.log(`${item.position}\t${item.id}\t${item.prompt}`),
      );
    return;
  }

  if (action === "queue-remove") {
    if (!options.item) throw new Error("--item is required");
    await controls.removeQueueItem(runId, options.item);
    if (options.json) console.log(JSON.stringify({ removed: options.item }));
    return;
  }

  if (action === "queue-update") {
    if (!options.item || !options.prompt) {
      throw new Error("--item and --prompt are required");
    }
    const current = (await controls.listQueue(runId)).find(
      (item) => item.id === options.item,
    );
    if (!current) throw new Error(`Queue item ${options.item} was not found`);
    const item = await controls.updateQueueItem(runId, options.item, {
      prompt: options.prompt,
      behavior: options.behavior ?? current.behavior,
    });
    console.log(options.json ? JSON.stringify({ item }, null, 2) : item.id);
    return;
  }

  if (action === "queue-reorder") {
    if (!options.items?.length) throw new Error("--items is required");
    const queue = await controls.reorderQueue(runId, options.items);
    if (options.json) console.log(JSON.stringify({ queue }, null, 2));
    return;
  }

  if (action === "checkpoints") {
    const checkpoints = await controls.listCheckpoints(runId);
    if (options.json) console.log(JSON.stringify({ checkpoints }, null, 2));
    else
      checkpoints.forEach((item) =>
        console.log(`${item.id}\t${item.createdAt}\t${item.label ?? ""}`),
      );
    return;
  }

  if (action === "checkpoint") {
    const checkpoint = await controls.createCheckpoint(runId, options.label);
    console.log(
      options.json ? JSON.stringify({ checkpoint }, null, 2) : checkpoint.id,
    );
    return;
  }

  if (action === "checkpoint-restore") {
    if (!options.item) throw new Error("--item is required");
    await controls.restoreCheckpoint(runId, options.item);
    if (options.json) console.log(JSON.stringify({ restored: options.item }));
    return;
  }

  if (action === "plan-list" || action === "plan-export") {
    const plans = await controls.listPlans(runId);
    if (action === "plan-export" || options.json) {
      console.log(JSON.stringify({ plans }, null, 2));
    } else {
      plans.forEach((plan) =>
        console.log(
          `${plan.id}\t${plan.status}\t${plan.items.filter((item) => item.status === "completed").length}/${plan.items.length}\t${plan.title}`,
        ),
      );
    }
    return;
  }

  if (action === "plan-create") {
    if (!options.title || !options.steps?.length) {
      throw new Error("--title and --steps are required");
    }
    const plan = await controls.createPlan(runId, options.title, options.steps);
    console.log(options.json ? JSON.stringify({ plan }, null, 2) : plan.id);
    return;
  }

  if (action === "plan-update") {
    if (!options.item || !options.title || !options.steps?.length) {
      throw new Error("--item, --title, and --steps are required");
    }
    const current = (await controls.listPlans(runId)).find(
      (plan) => plan.id === options.item,
    );
    if (!current) throw new Error(`Plan ${options.item} was not found`);
    const plan = await controls.updatePlan(
      runId,
      current.id,
      {
        title: options.title,
        items: options.steps.map((text, index) =>
          current.items[index]
            ? { ...current.items[index], text }
            : {
                id: `${current.id}-item-${index + 1}`,
                text,
                status: "pending",
              },
        ),
      },
      current.revision,
    );
    console.log(options.json ? JSON.stringify({ plan }, null, 2) : plan.id);
    return;
  }

  if (action === "plan-status") {
    if (!options.item || !options.planStatus) {
      throw new Error("--item and --plan-status are required");
    }
    const current = (await controls.listPlans(runId)).find(
      (plan) => plan.id === options.item,
    );
    if (!current) throw new Error(`Plan ${options.item} was not found`);
    const plan = await controls.setPlanStatus(
      runId,
      current.id,
      options.planStatus,
      current.revision,
    );
    console.log(options.json ? JSON.stringify({ plan }, null, 2) : plan.id);
    return;
  }

  throw new Error(`Unknown agents action: ${action}`);
}
