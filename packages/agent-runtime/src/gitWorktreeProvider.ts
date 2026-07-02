import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentCheckpoint, AgentRun, AgentWorkspace } from "./contracts.js";
import type { AgentWorkspaceProvider } from "./localRuntime.js";

const execFileAsync = promisify(execFile);

function isNotGitRepositoryError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${(error as any).stderr ?? ""}`
      : String(error);
  return /not a git repository|not a repository/i.test(text);
}

export interface GitWorktreeWorkspaceProviderOptions {
  rootDirectory?: string;
  branchPrefix?: string;
  retainCompletedWorktrees?: boolean;
}

export class GitWorktreeWorkspaceProvider implements AgentWorkspaceProvider {
  private readonly rootDirectory: string;
  private readonly branchPrefix: string;
  private repositoryMutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: GitWorktreeWorkspaceProviderOptions = {},
  ) {
    this.rootDirectory =
      options.rootDirectory ??
      path.join(os.tmpdir(), "continue-agent-worktrees");
    this.branchPrefix = options.branchPrefix ?? "continue/agent-";
  }

  async prepare(run: AgentRun): Promise<AgentWorkspace> {
    if (run.workspace.worktreePath) return run.workspace;
    let repositoryPath: string;
    try {
      repositoryPath = await this.git(
        run.workspace.repositoryPath,
        "rev-parse",
        "--show-toplevel",
      );
    } catch (error) {
      if (!isNotGitRepositoryError(error)) throw error;
      // Local development folders do not have to be Git repositories. Run in
      // place and omit worktree/checkpoint metadata rather than failing before
      // the executor starts. The permission policy still governs all edits.
      return {
        ...run.workspace,
        worktreePath: undefined,
        branch: undefined,
        baseRevision: undefined,
        retained: true,
      };
    }
    const baseRevision = await this.git(repositoryPath, "rev-parse", "HEAD");
    const safeId = run.id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48);
    const worktreePath = path.join(this.rootDirectory, safeId);
    const branch = run.workspace.branch ?? `${this.branchPrefix}${safeId}`;
    await mkdir(this.rootDirectory, { recursive: true });

    const staged = await this.gitRaw(
      repositoryPath,
      "diff",
      "--binary",
      "--cached",
    );
    const unstaged = await this.gitRaw(repositoryPath, "diff", "--binary");
    const untracked = (
      await this.gitRaw(
        repositoryPath,
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
      )
    )
      .split("\0")
      .filter(Boolean);

    await this.withRepositoryMutation(() =>
      this.git(
        repositoryPath,
        "worktree",
        "add",
        "-b",
        branch,
        worktreePath,
        baseRevision,
      ),
    );
    if (staged) await this.applyPatch(worktreePath, staged, true);
    if (unstaged) await this.applyPatch(worktreePath, unstaged, false);
    for (const relativePath of untracked) {
      const source = path.resolve(repositoryPath, relativePath);
      const destination = path.resolve(worktreePath, relativePath);
      if (!destination.startsWith(`${path.resolve(worktreePath)}${path.sep}`)) {
        throw new Error(`Unsafe untracked path: ${relativePath}`);
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, errorOnExist: false });
    }

    return {
      ...run.workspace,
      repositoryPath,
      worktreePath,
      branch,
      baseRevision,
      retained: this.options.retainCompletedWorktrees ?? false,
    };
  }

  async createCheckpoint(
    run: AgentRun,
    checkpoint: AgentCheckpoint,
  ): Promise<Partial<AgentCheckpoint>> {
    if (!run.workspace.worktreePath) return {};
    const worktreePath = this.requireWorktree(run);
    await this.git(worktreePath, "add", "-A");
    await this.git(
      worktreePath,
      "-c",
      "user.name=Continue Agent",
      "-c",
      "user.email=agent@continue.local",
      "commit",
      "--allow-empty",
      "--no-verify",
      "-m",
      `continue checkpoint: ${checkpoint.label ?? checkpoint.id}`,
    );
    return { baseRevision: await this.git(worktreePath, "rev-parse", "HEAD") };
  }

  async restoreCheckpoint(
    run: AgentRun,
    checkpoint: AgentCheckpoint,
  ): Promise<void> {
    const worktreePath = this.requireWorktree(run);
    if (!checkpoint.baseRevision) {
      throw new Error(`Checkpoint ${checkpoint.id} has no Git revision`);
    }
    await this.git(worktreePath, "reset", "--hard", checkpoint.baseRevision);
    await this.git(worktreePath, "clean", "-fd");
  }

  async cleanup(workspace: AgentWorkspace): Promise<void> {
    if (workspace.retained || !workspace.worktreePath) return;
    await this.withRepositoryMutation(async () => {
      await this.git(
        workspace.repositoryPath,
        "worktree",
        "remove",
        "--force",
        workspace.worktreePath!,
      );
      if (workspace.branch) {
        await this.git(
          workspace.repositoryPath,
          "branch",
          "-D",
          workspace.branch,
        ).catch(() => undefined);
      }
      await this.git(workspace.repositoryPath, "worktree", "prune");
    });
  }

  async rename(run: AgentRun, branch: string): Promise<AgentWorkspace> {
    const normalized = branch.trim();
    if (
      !/^(?!\/|.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._\/-]+$/.test(
        normalized,
      )
    ) {
      throw new Error(`Invalid Git branch name: ${branch}`);
    }
    const worktreePath = this.requireWorktree(run);
    await this.withRepositoryMutation(() =>
      this.git(worktreePath, "branch", "-m", normalized),
    );
    return { ...run.workspace, branch: normalized };
  }

  async exportPatch(run: AgentRun): Promise<string> {
    const worktreePath = this.requireWorktree(run);
    const base = run.workspace.baseRevision ?? "HEAD";
    const untracked = (
      await this.gitRaw(
        worktreePath,
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
      )
    )
      .split("\0")
      .filter(Boolean);
    if (untracked.length > 0) {
      await this.git(worktreePath, "add", "-N", "--", ...untracked);
    }
    return this.gitRaw(worktreePath, "diff", "--binary", base, "--");
  }

  async merge(run: AgentRun): Promise<{ commit: string; mergedInto: string }> {
    const worktreePath = this.requireWorktree(run);
    if (!run.workspace.branch) throw new Error("Worktree has no branch");
    await this.git(worktreePath, "add", "-A");
    const hasChanges = Boolean(
      await this.gitRaw(worktreePath, "status", "--porcelain"),
    );
    if (hasChanges) {
      await this.git(
        worktreePath,
        "-c",
        "user.name=Continue Agent",
        "-c",
        "user.email=agent@continue.local",
        "commit",
        "--no-verify",
        "-m",
        `Continue agent: ${run.title}`,
      );
    }
    const repositoryStatus = await this.gitRaw(
      run.workspace.repositoryPath,
      "status",
      "--porcelain",
    );
    if (repositoryStatus.trim()) {
      throw new Error(
        "The target repository has uncommitted changes; commit or stash them before merging",
      );
    }
    const mergedInto = await this.git(
      run.workspace.repositoryPath,
      "branch",
      "--show-current",
    );
    if (!mergedInto) throw new Error("Cannot merge into a detached HEAD");
    await this.withRepositoryMutation(() =>
      this.git(
        run.workspace.repositoryPath,
        "-c",
        "user.name=Continue Agent",
        "-c",
        "user.email=agent@continue.local",
        "merge",
        "--no-ff",
        "--no-edit",
        run.workspace.branch!,
      ),
    );
    return {
      commit: await this.git(run.workspace.repositoryPath, "rev-parse", "HEAD"),
      mergedInto,
    };
  }

  private requireWorktree(run: AgentRun): string {
    if (!run.workspace.worktreePath) {
      throw new Error(`Agent run ${run.id} has no prepared worktree`);
    }
    return run.workspace.worktreePath;
  }

  private async applyPatch(
    worktreePath: string,
    patch: string,
    staged: boolean,
  ): Promise<void> {
    const patchPath = path.join(
      this.rootDirectory,
      `.patch-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await writeFile(patchPath, patch, "utf8");
    try {
      await this.git(
        worktreePath,
        "apply",
        "--binary",
        ...(staged ? ["--index"] : []),
        patchPath,
      );
    } finally {
      await rm(patchPath, { force: true }).catch(() => undefined);
    }
  }

  private async git(cwd: string, ...args: string[]): Promise<string> {
    return (await this.gitRaw(cwd, ...args)).trim();
  }

  private async gitRaw(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  }

  private async withRepositoryMutation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.repositoryMutationQueue;
    let release!: () => void;
    this.repositoryMutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
