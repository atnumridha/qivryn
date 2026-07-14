import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export interface TerminalJob {
  id: string;
  command: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "stopped" | "interrupted";
  createdAt: string;
  updatedAt: string;
  pid?: number;
  exitCode?: number;
}

export class TerminalJobService {
  private readonly active = new Map<string, ChildProcess>();
  private readonly completions = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const job of await this.list()) {
      if (job.status !== "running" || !job.pid) continue;
      try {
        process.kill(job.pid, 0);
      } catch {
        await this.save({
          ...job,
          status: "interrupted",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  async start(command: string, cwd: string): Promise<TerminalJob> {
    if (!command.trim())
      throw new Error("Terminal job command cannot be empty");
    const id = randomUUID();
    const outputPath = this.outputPath(id);
    const output = await open(outputPath, "a", 0o600);
    const shell =
      process.platform === "win32"
        ? (process.env.COMSPEC ?? "cmd.exe")
        : (process.env.SHELL ?? "/bin/sh");
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-c", command];
    const child = spawn(shell, args, {
      cwd: path.resolve(cwd),
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", output.fd, output.fd],
    });
    const now = new Date().toISOString();
    const job: TerminalJob = {
      id,
      command,
      cwd: path.resolve(cwd),
      status: "running",
      createdAt: now,
      updatedAt: now,
      pid: child.pid,
    };
    const initialSave = this.save(job);
    this.active.set(id, child);
    let complete!: () => void;
    this.completions.set(
      id,
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    child.once("exit", (code, signal) => {
      this.active.delete(id);
      void (async () => {
        await initialSave;
        await output.close();
        await this.save({
          ...job,
          status: signal ? "stopped" : code === 0 ? "completed" : "failed",
          exitCode: code ?? undefined,
          updatedAt: new Date().toISOString(),
        });
        this.completions.delete(id);
        complete();
      })();
    });
    child.once("error", () => void output.close());
    child.unref();
    await initialSave;
    return job;
  }

  async list(): Promise<TerminalJob[]> {
    await mkdir(this.root, { recursive: true });
    const files = (await readdir(this.root)).filter((file) =>
      file.endsWith(".json"),
    );
    const jobs = await Promise.all(
      files.map(
        async (file) =>
          JSON.parse(
            await readFile(path.join(this.root, file), "utf8"),
          ) as TerminalJob,
      ),
    );
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<TerminalJob | undefined> {
    try {
      return JSON.parse(
        await readFile(this.jobPath(id), "utf8"),
      ) as TerminalJob;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async output(id: string): Promise<string> {
    try {
      return await readFile(this.outputPath(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }

  async stop(id: string): Promise<TerminalJob> {
    const job = await this.get(id);
    if (!job) throw new Error(`Terminal job ${id} does not exist`);
    if (job.status !== "running" || !job.pid) return job;
    const child = this.active.get(id);
    if (child) child.kill("SIGTERM");
    else
      process.kill(
        process.platform === "win32" ? job.pid : -job.pid,
        "SIGTERM",
      );
    const completion = this.completions.get(id);
    if (completion) await completion;
    return (await this.get(id)) ?? job;
  }

  private jobPath(id: string) {
    return path.join(this.root, `${id}.json`);
  }
  private outputPath(id: string) {
    return path.join(this.root, `${id}.log`);
  }
  private async save(job: TerminalJob): Promise<TerminalJob> {
    const destination = this.jobPath(job.id);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, destination);
    return job;
  }
}
