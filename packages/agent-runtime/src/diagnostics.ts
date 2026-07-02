import { createHash } from "node:crypto";
import os from "node:os";
import type { AgentEventKind, AgentRun } from "./contracts.js";
import type { AgentStore } from "./store.js";

export interface AgentDiagnosticRun {
  id: string;
  status: AgentRun["status"];
  runtimeId?: string;
  permissionMode: AgentRun["permissionMode"];
  createdAt: string;
  updatedAt: string;
  workspaceFingerprint: string;
  hasWorktree: boolean;
  eventCounts: Partial<Record<AgentEventKind, number>>;
  queueLength: number;
  checkpointCount: number;
  planCount: number;
  statusReason?: string;
}

export interface AgentDiagnosticReport {
  schemaVersion: 1;
  createdAt: string;
  environment: {
    platform: NodeJS.Platform;
    arch: string;
    node: string;
    cpuCount: number;
  };
  runs: AgentDiagnosticRun[];
  redaction: {
    prompts: true;
    eventPayloads: true;
    filesystemPaths: true;
    credentials: true;
  };
  uploadPerformed: false;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function createAgentDiagnosticReport(
  store: AgentStore,
): Promise<AgentDiagnosticReport> {
  await store.initialize();
  const runs = await store.listRuns({ includeArchived: true });
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpuCount: os.cpus().length,
    },
    runs: await Promise.all(
      runs.map(async (run) => {
        const [events, queue, checkpoints, plans] = await Promise.all([
          store.readEvents(run.id),
          store.listQueue(run.id),
          store.listCheckpoints(run.id),
          store.listPlans(run.id),
        ]);
        const eventCounts: Partial<Record<AgentEventKind, number>> = {};
        for (const event of events) {
          eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;
        }
        return {
          id: run.id,
          status: run.status,
          runtimeId: run.runtimeId,
          permissionMode: run.permissionMode,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          workspaceFingerprint: fingerprint(run.workspace.repositoryPath),
          hasWorktree: Boolean(run.workspace.worktreePath),
          eventCounts,
          queueLength: queue.length,
          checkpointCount: checkpoints.length,
          planCount: plans.length,
          statusReason: run.statusReason,
        };
      }),
    ),
    redaction: {
      prompts: true,
      eventPayloads: true,
      filesystemPaths: true,
      credentials: true,
    },
    uploadPerformed: false,
  };
}
