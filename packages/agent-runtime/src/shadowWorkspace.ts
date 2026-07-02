import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { AgentRun } from "./contracts.js";
import { GitWorktreeWorkspaceProvider } from "./gitWorktreeProvider.js";

const execFileAsync = promisify(execFile);

export interface ShadowValidationResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class ShadowWorkspaceValidator {
  constructor(private readonly provider = new GitWorktreeWorkspaceProvider()) {}

  async validate(
    repositoryPath: string,
    command: string,
    args: string[] = [],
  ): Promise<ShadowValidationResult> {
    if (!command.trim())
      throw new Error("Shadow validation command cannot be empty");
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: `shadow-${randomUUID()}`,
      revision: 0,
      title: "Shadow validation",
      prompt: command,
      status: "running",
      createdAt: now,
      updatedAt: now,
      permissionMode: "readOnly",
      workspace: { id: randomUUID(), location: "local", repositoryPath },
    };
    run.workspace = await this.provider.prepare(run);
    const started = Date.now();
    try {
      const result = await execFileAsync(command, args, {
        cwd: run.workspace.worktreePath,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      });
      return {
        command,
        args,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        command,
        args,
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message,
        durationMs: Date.now() - started,
      };
    } finally {
      await this.provider.cleanup(run.workspace);
    }
  }
}
