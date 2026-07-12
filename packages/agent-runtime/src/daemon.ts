import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type {
  AgentApprovalDecision,
  AgentApprovalResolution,
  AgentControlRequest,
  AgentControlResult,
  AgentEvent,
  AgentQueueItem,
  AgentPlan,
  AgentRun,
  AgentRunSnapshot,
  AgentWorkspace,
  AgentRuntimeAdapter,
  CreateAgentRunRequest,
  ListAgentRunsOptions,
  ReadAgentEventsOptions,
  RuntimeCapabilities,
  StreamAgentEventsOptions,
  ExternalAgentEvent,
} from "./contracts.js";

export interface AgentDaemonServerOptions {
  host?: string;
  port?: number;
  token: string;
  maxBodyBytes?: number;
}

export interface AgentDaemonAddress {
  host: string;
  port: number;
  baseUrl: string;
}

// Version 6 requires both imported Codex hook objects and model transport for
// read-only workers.
// Bump this whenever persisted runtime configuration needs new parsing logic so
// an extension update cannot silently reuse an older detached worker.
export const AGENT_DAEMON_PROTOCOL_VERSION = 6;

export interface AgentDaemonDescriptor {
  baseUrl: string;
  token: string;
  pid: number;
  createdAt: string;
  protocolVersion?: number;
}

export async function readAgentDaemonDescriptor(
  filepath: string,
): Promise<AgentDaemonDescriptor | undefined> {
  try {
    return JSON.parse(
      await readFile(filepath, "utf8"),
    ) as AgentDaemonDescriptor;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function connectAgentDaemon(
  filepath: string,
): Promise<HttpAgentRuntimeClient | undefined> {
  const descriptor = await readAgentDaemonDescriptor(filepath);
  if (!descriptor) return undefined;
  if (descriptor.protocolVersion !== AGENT_DAEMON_PROTOCOL_VERSION) {
    try {
      process.kill(descriptor.pid, "SIGTERM");
    } catch {
      // A stale descriptor can point at a process that already exited.
    }
    await rm(filepath, { force: true });
    return undefined;
  }
  const client = new HttpAgentRuntimeClient({
    baseUrl: descriptor.baseUrl,
    token: descriptor.token,
  });
  try {
    await client.initialize();
    return client;
  } catch {
    let processIsAlive = true;
    try {
      process.kill(descriptor.pid, 0);
    } catch {
      processIsAlive = false;
    }
    if (
      !processIsAlive ||
      descriptor.protocolVersion !== AGENT_DAEMON_PROTOCOL_VERSION
    ) {
      await rm(filepath, { force: true });
    }
    return undefined;
  }
}

export class AgentDaemonServer {
  private readonly server = createServer((request, response) => {
    void this.handle(request, response);
  });

  constructor(
    private readonly runtime: AgentRuntimeAdapter,
    private readonly options: AgentDaemonServerOptions,
  ) {}

  async start(): Promise<AgentDaemonAddress> {
    await this.runtime.initialize();
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(
        this.options.port ?? 0,
        this.options.host ?? "127.0.0.1",
        resolve,
      );
    });
    const address = this.server.address() as AddressInfo;
    return {
      host: address.address,
      port: address.port,
      baseUrl: `http://${address.address}:${address.port}`,
    };
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (request.headers.authorization !== `Bearer ${this.options.token}`) {
        this.json(response, 401, { error: "Unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const segments = url.pathname.split("/").filter(Boolean);
      if (request.method === "GET" && url.pathname === "/health") {
        this.json(response, 200, {
          capabilities: this.runtime.capabilities,
          protocolVersion: AGENT_DAEMON_PROTOCOL_VERSION,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/runs") {
        const statuses = url.searchParams.get("statuses")?.split(",") as
          | AgentRun["status"][]
          | undefined;
        const runs = await this.runtime.listRuns({
          statuses,
          includeArchived: url.searchParams.get("includeArchived") === "true",
          repositoryPath: url.searchParams.get("repositoryPath") ?? undefined,
          limit: this.numberParam(url, "limit"),
        });
        this.json(response, 200, { runs });
        return;
      }
      if (request.method === "POST" && url.pathname === "/runs") {
        const run = await this.runtime.createRun(
          await this.body<CreateAgentRunRequest>(request),
        );
        this.json(response, 201, { run });
        return;
      }
      if (request.method === "POST" && url.pathname === "/control") {
        const result = await this.control(
          await this.body<AgentControlRequest>(request),
        );
        this.json(response, 200, { result });
        return;
      }
      if (segments[0] === "runs" && segments[1]) {
        const runId = decodeURIComponent(segments[1]);
        if (request.method === "GET" && segments.length === 2) {
          const run = await this.runtime.getRun(runId);
          this.json(response, run ? 200 : 404, { run });
          return;
        }
        if (request.method === "POST" && segments[2] === "cancel") {
          const body = await this.body<{ reason?: string }>(request);
          this.json(response, 200, {
            run: await this.runtime.cancelRun(runId, body.reason),
          });
          return;
        }
        if (request.method === "POST" && segments[2] === "resume") {
          this.json(response, 200, {
            run: await this.runtime.resumeRun(runId),
          });
          return;
        }
        if (request.method === "GET" && segments[2] === "events") {
          const events = await this.runtime.readEvents(runId, {
            afterSequence: this.numberParam(url, "afterSequence"),
            limit: this.numberParam(url, "limit"),
          });
          this.json(response, 200, { events });
          return;
        }
        if (request.method === "POST" && segments[2] === "ingest") {
          const remote = request.socket.remoteAddress ?? "";
          if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
            this.json(response, 403, {
              error: "NDJSON ingest is loopback-only",
            });
            return;
          }
          if (
            !(request.headers["content-type"] ?? "").includes(
              "application/x-ndjson",
            )
          ) {
            this.json(response, 415, {
              error: "Expected application/x-ndjson",
            });
            return;
          }
          const lines = (await this.textBody(request))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          const events = lines.map(
            (line) => JSON.parse(line) as ExternalAgentEvent,
          );
          this.json(response, 200, {
            events: await this.runtime.ingestEvents(runId, events),
          });
          return;
        }
        if (request.method === "GET" && segments[2] === "export") {
          this.json(response, 200, {
            snapshot: await this.runtime.exportRun(runId),
          });
          return;
        }
        if (request.method === "GET" && segments[2] === "stream") {
          await this.stream(runId, url, request, response);
          return;
        }
        if (request.method === "GET" && segments[2] === "queue") {
          this.json(response, 200, {
            queue: await this.runtime.listQueue(runId),
          });
          return;
        }
        if (request.method === "GET" && segments[2] === "checkpoints") {
          this.json(response, 200, {
            checkpoints: await this.runtime.listCheckpoints(runId),
          });
          return;
        }
        if (request.method === "GET" && segments[2] === "plans") {
          this.json(response, 200, {
            plans: await this.runtime.listPlans(runId),
          });
          return;
        }
      }
      if (request.method === "POST" && url.pathname === "/imports") {
        const body = await this.body<{
          snapshot: AgentRunSnapshot;
          workspace?: Partial<AgentWorkspace>;
        }>(request);
        this.json(response, 201, {
          run: await this.runtime.importRun(body.snapshot, body.workspace),
        });
        return;
      }
      this.json(response, 404, { error: "Not found" });
    } catch (error) {
      this.json(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async control(
    request: AgentControlRequest,
  ): Promise<AgentControlResult> {
    switch (request.action) {
      case "run.create":
        return this.runtime.createRun(request.request);
      case "run.cancel":
        return this.runtime.cancelRun(request.runId, request.reason);
      case "run.resume":
        return this.runtime.resumeRun(request.runId);
      case "run.duplicate":
        return this.runtime.duplicateRun(
          request.runId,
          request.title,
          request.idempotencyKey,
        );
      case "run.cleanup":
        return this.runtime.cleanupRun(request.runId);
      case "worktree.retain":
        return this.runtime.retainWorktree(request.runId, request.retained);
      case "worktree.rename":
        return this.runtime.renameWorktree(request.runId, request.branch);
      case "worktree.export":
        return this.runtime.exportWorktreePatch(request.runId);
      case "worktree.merge":
        return this.runtime.mergeWorktree(request.runId);
      case "rename":
        return this.runtime.renameRun(request.runId, request.title);
      case "permission.set":
        return this.runtime.setRunPermission(
          request.runId,
          request.permissionMode,
        );
      case "approval.resolve":
        return this.runtime.resolveApproval(
          request.runId,
          request.approvalId,
          request.decision,
        );
      case "pin":
        return this.runtime.setRunPinned(request.runId, request.pinned);
      case "unread":
        return this.runtime.setRunUnread(request.runId, request.unread);
      case "archive":
        return this.runtime.archiveRun(request.runId);
      case "unarchive":
        return this.runtime.unarchiveRun(request.runId);
      case "queue.add":
        return this.runtime.enqueuePrompt(
          request.runId,
          request.prompt,
          request.behavior,
        );
      case "queue.update":
        return this.runtime.updateQueueItem(request.runId, request.itemId, {
          prompt: request.prompt,
          behavior: request.behavior,
        });
      case "queue.remove":
        return this.runtime.removeQueueItem(request.runId, request.itemId);
      case "queue.reorder":
        return this.runtime.reorderQueue(request.runId, request.itemIds);
      case "checkpoint.create":
        return this.runtime.createCheckpoint(request.runId, request.label);
      case "checkpoint.restore":
        return this.runtime.restoreCheckpoint(
          request.runId,
          request.checkpointId,
        );
      case "plan.create":
        return this.runtime.createPlan(
          request.runId,
          request.title,
          request.items,
        );
      case "plan.update":
        return this.runtime.updatePlan(
          request.runId,
          request.planId,
          { title: request.title, items: request.items },
          request.expectedRevision,
        );
      case "plan.status":
        return this.runtime.setPlanStatus(
          request.runId,
          request.planId,
          request.status,
          request.expectedRevision,
        );
    }
  }

  private async stream(
    runId: string,
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const controller = new AbortController();
    request.once("close", () => controller.abort());
    for await (const event of this.runtime.streamEvents(runId, {
      afterSequence: this.numberParam(url, "afterSequence"),
      signal: controller.signal,
    })) {
      response.write(
        `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    }
    response.end();
  }

  private async body<T>(request: IncomingMessage): Promise<T> {
    const text = await this.textBody(request);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async textBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > (this.options.maxBodyBytes ?? 1_048_576)) {
        throw new Error("Request body is too large");
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private numberParam(url: URL, name: string): number | undefined {
    const value = url.searchParams.get(name);
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

export interface HttpAgentRuntimeClientOptions {
  baseUrl: string;
  token: string;
  capabilities?: RuntimeCapabilities;
}

export class HttpAgentRuntimeClient implements AgentRuntimeAdapter {
  readonly capabilities: RuntimeCapabilities;

  constructor(private readonly options: HttpAgentRuntimeClientOptions) {
    this.capabilities = options.capabilities ?? {
      local: true,
      remote: false,
      persistent: true,
      worktrees: true,
      checkpoints: true,
      browser: false,
      review: false,
      maxConcurrency: 4,
    };
  }

  async initialize(): Promise<void> {
    await this.request("/health", "GET", undefined, AbortSignal.timeout(1_500));
  }

  async createRun(request: CreateAgentRunRequest): Promise<AgentRun> {
    return (await this.request<{ run: AgentRun }>("/runs", "POST", request))
      .run;
  }

  async getRun(runId: string): Promise<AgentRun | undefined> {
    return (
      await this.request<{ run?: AgentRun }>(
        `/runs/${encodeURIComponent(runId)}`,
      )
    ).run;
  }

  async listRuns(options: ListAgentRunsOptions = {}): Promise<AgentRun[]> {
    const query = new URLSearchParams();
    if (options.statuses) query.set("statuses", options.statuses.join(","));
    if (options.includeArchived) query.set("includeArchived", "true");
    if (options.repositoryPath)
      query.set("repositoryPath", options.repositoryPath);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    return (await this.request<{ runs: AgentRun[] }>(`/runs?${query}`)).runs;
  }

  async readEvents(
    runId: string,
    options: ReadAgentEventsOptions = {},
  ): Promise<AgentEvent[]> {
    const query = new URLSearchParams();
    if (options.afterSequence !== undefined)
      query.set("afterSequence", String(options.afterSequence));
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    return (
      await this.request<{ events: AgentEvent[] }>(
        `/runs/${encodeURIComponent(runId)}/events?${query}`,
      )
    ).events;
  }

  async *streamEvents(
    runId: string,
    options: StreamAgentEventsOptions = {},
  ): AsyncIterable<AgentEvent> {
    const query = new URLSearchParams();
    if (options.afterSequence !== undefined) {
      query.set("afterSequence", String(options.afterSequence));
    }
    const response = await fetch(
      `${this.options.baseUrl}/runs/${encodeURIComponent(runId)}/stream?${query}`,
      {
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: "text/event-stream",
        },
        signal: options.signal,
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Agent runtime request failed (${response.status}): ${body}`,
      );
    }
    if (!response.body) {
      throw new Error("Agent runtime returned an empty event stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!options.signal?.aborted) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) yield JSON.parse(data) as AgentEvent;
        }
        if (done) return;
      }
    } catch (error) {
      if (options.signal?.aborted) return;
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async resumeRun(runId: string): Promise<AgentRun> {
    return (
      await this.request<{ run: AgentRun }>(
        `/runs/${encodeURIComponent(runId)}/resume`,
        "POST",
        {},
      )
    ).run;
  }

  async cancelRun(runId: string, reason?: string): Promise<AgentRun> {
    return (
      await this.request<{ run: AgentRun }>(
        `/runs/${encodeURIComponent(runId)}/cancel`,
        "POST",
        { reason },
      )
    ).run;
  }

  duplicateRun(
    runId: string,
    title?: string,
    idempotencyKey?: string,
  ): Promise<AgentRun> {
    return this.control<AgentRun>({
      action: "run.duplicate",
      runId,
      title,
      idempotencyKey,
    });
  }

  cleanupRun(runId: string): Promise<void> {
    return this.control<void>({ action: "run.cleanup", runId });
  }

  retainWorktree(runId: string, retained: boolean) {
    return this.control<import("./contracts.js").AgentWorktreeResult>({
      action: "worktree.retain",
      runId,
      retained,
    });
  }
  renameWorktree(runId: string, branch: string) {
    return this.control<import("./contracts.js").AgentWorktreeResult>({
      action: "worktree.rename",
      runId,
      branch,
    });
  }
  exportWorktreePatch(runId: string) {
    return this.control<import("./contracts.js").AgentWorktreeResult>({
      action: "worktree.export",
      runId,
    });
  }
  mergeWorktree(runId: string) {
    return this.control<import("./contracts.js").AgentWorktreeResult>({
      action: "worktree.merge",
      runId,
    });
  }

  renameRun(runId: string, title: string): Promise<AgentRun> {
    return this.control<AgentRun>({ action: "rename", runId, title });
  }
  setRunPermission(
    runId: string,
    permissionMode: AgentRun["permissionMode"],
  ): Promise<AgentRun> {
    return this.control<AgentRun>({
      action: "permission.set",
      runId,
      permissionMode,
    });
  }
  resolveApproval(
    runId: string,
    approvalId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalResolution> {
    return this.control<AgentApprovalResolution>({
      action: "approval.resolve",
      runId,
      approvalId,
      decision,
    });
  }
  setRunPinned(runId: string, pinned: boolean): Promise<AgentRun> {
    return this.control<AgentRun>({ action: "pin", runId, pinned });
  }
  setRunUnread(runId: string, unread: boolean): Promise<AgentRun> {
    return this.control<AgentRun>({ action: "unread", runId, unread });
  }
  archiveRun(runId: string): Promise<AgentRun> {
    return this.control<AgentRun>({ action: "archive", runId });
  }
  unarchiveRun(runId: string): Promise<AgentRun> {
    return this.control<AgentRun>({ action: "unarchive", runId });
  }
  enqueuePrompt(
    runId: string,
    prompt: string,
    behavior?: AgentQueueItem["behavior"],
  ): Promise<AgentQueueItem> {
    return this.control<AgentQueueItem>({
      action: "queue.add",
      runId,
      prompt,
      behavior,
    });
  }
  async listQueue(runId: string): Promise<AgentQueueItem[]> {
    return (
      await this.request<{ queue: AgentQueueItem[] }>(
        `/runs/${encodeURIComponent(runId)}/queue`,
      )
    ).queue;
  }
  updateQueueItem(
    runId: string,
    itemId: string,
    update: Pick<AgentQueueItem, "prompt" | "behavior">,
  ): Promise<AgentQueueItem> {
    return this.control<AgentQueueItem>({
      action: "queue.update",
      runId,
      itemId,
      ...update,
    });
  }
  removeQueueItem(runId: string, itemId: string): Promise<void> {
    return this.control<void>({ action: "queue.remove", runId, itemId });
  }
  reorderQueue(runId: string, itemIds: string[]): Promise<AgentQueueItem[]> {
    return this.control<AgentQueueItem[]>({
      action: "queue.reorder",
      runId,
      itemIds,
    });
  }
  createCheckpoint(runId: string, label?: string) {
    return this.control<import("./contracts.js").AgentCheckpoint>({
      action: "checkpoint.create",
      runId,
      label,
    });
  }
  async listCheckpoints(runId: string) {
    return (
      await this.request<{
        checkpoints: import("./contracts.js").AgentCheckpoint[];
      }>(`/runs/${encodeURIComponent(runId)}/checkpoints`)
    ).checkpoints;
  }
  restoreCheckpoint(runId: string, checkpointId: string): Promise<void> {
    return this.control<void>({
      action: "checkpoint.restore",
      runId,
      checkpointId,
    });
  }

  createPlan(
    runId: string,
    title: string,
    items: string[],
  ): Promise<AgentPlan> {
    return this.control<AgentPlan>({
      action: "plan.create",
      runId,
      title,
      items,
    });
  }

  async listPlans(runId: string): Promise<AgentPlan[]> {
    return (
      await this.request<{ plans: AgentPlan[] }>(
        `/runs/${encodeURIComponent(runId)}/plans`,
      )
    ).plans;
  }

  updatePlan(
    runId: string,
    planId: string,
    update: Pick<AgentPlan, "title" | "items">,
    expectedRevision: number,
  ): Promise<AgentPlan> {
    return this.control<AgentPlan>({
      action: "plan.update",
      runId,
      planId,
      ...update,
      expectedRevision,
    });
  }

  setPlanStatus(
    runId: string,
    planId: string,
    status: AgentPlan["status"],
    expectedRevision: number,
  ): Promise<AgentPlan> {
    return this.control<AgentPlan>({
      action: "plan.status",
      runId,
      planId,
      status,
      expectedRevision,
    });
  }

  async exportRun(runId: string): Promise<AgentRunSnapshot> {
    return (
      await this.request<{ snapshot: AgentRunSnapshot }>(
        `/runs/${encodeURIComponent(runId)}/export`,
      )
    ).snapshot;
  }

  async importRun(
    snapshot: AgentRunSnapshot,
    workspace?: Partial<AgentWorkspace>,
  ): Promise<AgentRun> {
    return (
      await this.request<{ run: AgentRun }>("/imports", "POST", {
        snapshot,
        workspace,
      })
    ).run;
  }

  async ingestEvents(
    runId: string,
    events: ExternalAgentEvent[],
  ): Promise<AgentEvent[]> {
    const response = await fetch(
      `${this.options.baseUrl}/runs/${encodeURIComponent(runId)}/ingest`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/x-ndjson",
        },
        body: events.map((event) => JSON.stringify(event)).join("\n"),
      },
    );
    const payload = (await response.json()) as {
      events?: AgentEvent[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? `Agent daemon HTTP ${response.status}`);
    }
    return payload.events ?? [];
  }

  private async control<T>(request: AgentControlRequest): Promise<T> {
    return (await this.request<{ result: T }>("/control", "POST", request))
      .result;
  }

  private async request<T = unknown>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      signal,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new Error(payload.error ?? `Agent daemon HTTP ${response.status}`);
    return payload;
  }
}
