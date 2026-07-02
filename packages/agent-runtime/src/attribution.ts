import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentLineAttribution, AgentRun } from "./contracts.js";
import type { AgentStore } from "./store.js";

const execFileAsync = promisify(execFile);

export function parseAgentDiffAttributions(
  diff: string,
  run: AgentRun,
  context: { eventSequence?: number; checkpointId?: string } = {},
): AgentLineAttribution[] {
  const workspacePath =
    run.workspace.worktreePath ?? run.workspace.repositoryPath;
  const records: AgentLineAttribution[] = [];
  let filepath = "";
  let lineNumber = 0;
  let group: { start: number; lines: string[] } | undefined;
  const flush = () => {
    if (!group || !filepath || group.lines.length === 0) return;
    records.push({
      id: randomUUID(),
      runId: run.id,
      repositoryPath: run.workspace.repositoryPath,
      workspacePath,
      filepath,
      absolutePath: path.resolve(workspacePath, filepath),
      startLine: group.start,
      endLine: group.start + group.lines.length - 1,
      originalText: group.lines.join("\n"),
      createdAt: new Date().toISOString(),
      eventSequence: context.eventSequence,
      checkpointId: context.checkpointId,
    });
    group = undefined;
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) flush();
    if (line.startsWith("+++ ")) {
      flush();
      const value = line.slice(4).trim();
      filepath = value.startsWith("b/") ? value.slice(2) : value;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush();
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (!filepath || line.startsWith("--- ")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (!group) group = { start: lineNumber, lines: [] };
      group.lines.push(line.slice(1));
      lineNumber++;
    } else {
      flush();
      if (!line.startsWith("-")) lineNumber++;
    }
  }
  flush();
  return records;
}

export class FileAttributionStore {
  private readonly statePath: string;
  private readonly lockPath: string;

  constructor(private readonly rootDirectory: string) {
    this.statePath = path.join(rootDirectory, "attributions.json");
    this.lockPath = path.join(rootDirectory, ".attributions.lock");
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    try {
      await readFile(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.write([]);
    }
  }

  async replaceRun(
    runId: string,
    records: AgentLineAttribution[],
  ): Promise<void> {
    await this.mutate((current) => [
      ...current.filter((record) => record.runId !== runId),
      ...records,
    ]);
  }

  async listForFile(filepath: string): Promise<AgentLineAttribution[]> {
    const absolute = path.resolve(filepath);
    return (await this.read()).filter(
      (record) => path.resolve(record.absolutePath) === absolute,
    );
  }

  async resolveLine(
    filepath: string,
    line: number,
  ): Promise<AgentLineAttribution | undefined> {
    const records = await this.listForFile(filepath);
    const direct = records.find(
      (record) => line >= record.startLine && line <= record.endLine,
    );
    if (direct) return direct;
    let content: string;
    try {
      content = await readFile(filepath, "utf8");
    } catch {
      return undefined;
    }
    for (const record of records) {
      const matches = content
        .split("\n")
        .map((_, index, lines) =>
          lines
            .slice(index, index + record.originalText.split("\n").length)
            .join("\n") === record.originalText
            ? index + 1
            : -1,
        )
        .filter((value) => value > 0);
      if (matches.length === 1) {
        const length = record.originalText.split("\n").length;
        const anchored = {
          ...record,
          startLine: matches[0],
          endLine: matches[0] + length - 1,
        };
        if (line >= anchored.startLine && line <= anchored.endLine)
          return anchored;
      }
    }
    return undefined;
  }

  private async read(): Promise<AgentLineAttribution[]> {
    await this.initialize();
    return JSON.parse(await readFile(this.statePath, "utf8"));
  }

  private async write(records: AgentLineAttribution[]): Promise<void> {
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(temporary, this.statePath);
  }

  private async mutate(
    operation: (records: AgentLineAttribution[]) => AgentLineAttribution[],
  ): Promise<void> {
    await this.initialize();
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await open(this.lockPath, "wx");
        try {
          await this.write(operation(await this.read()));
          return;
        } finally {
          await handle.close();
          await rm(this.lockPath, { force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() - startedAt > 5_000)
          throw new Error("Timed out acquiring attribution store lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
}

export async function captureAgentAttributions(
  run: AgentRun,
  store: FileAttributionStore,
  agentStore?: AgentStore,
): Promise<AgentLineAttribution[]> {
  const workspace = run.workspace.worktreePath ?? run.workspace.repositoryPath;
  const { stdout } = await execFileAsync(
    "git",
    ["-C", workspace, "diff", "--unified=0", "--no-ext-diff", "HEAD"],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  const events = agentStore ? await agentStore.readEvents(run.id) : [];
  const checkpoints = agentStore
    ? await agentStore.listCheckpoints(run.id)
    : [];
  const records = parseAgentDiffAttributions(stdout, run, {
    eventSequence: events.at(-1)?.sequence,
    checkpointId: checkpoints.at(-1)?.id,
  });
  await store.replaceRun(run.id, records);
  return records;
}
