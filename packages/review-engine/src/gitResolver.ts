import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewRequest } from "@qivryn/agent-runtime";
import type { ReviewDiff } from "./contracts.js";

const execFileAsync = promisify(execFile);

export interface PullRequestReviewResolver {
  resolve(repositoryPath: string, url: string): Promise<ReviewDiff>;
}

export class GitReviewTargetResolver {
  constructor(private readonly pullRequests?: PullRequestReviewResolver) {}

  async resolve(
    repositoryPath: string,
    request: ReviewRequest,
  ): Promise<ReviewDiff> {
    const root = await this.git(repositoryPath, "rev-parse", "--show-toplevel");
    const target = request.target;
    if (target.type === "pull-request") {
      if (!this.pullRequests) {
        throw new Error(
          "Pull request reviews require a configured host adapter",
        );
      }
      return this.pullRequests.resolve(root, target.url);
    }

    let diffArgs: string[];
    let nameArgs: string[];
    let baseLabel: string;
    switch (target.type) {
      case "working-tree":
        diffArgs = ["diff", "--binary", "HEAD"];
        nameArgs = ["diff", "--name-only", "HEAD"];
        baseLabel = "HEAD";
        break;
      case "staged":
        diffArgs = ["diff", "--binary", "--cached"];
        nameArgs = ["diff", "--name-only", "--cached"];
        baseLabel = "index";
        break;
      case "commit":
        diffArgs = ["show", "--format=", "--binary", target.revision];
        nameArgs = ["show", "--format=", "--name-only", target.revision];
        baseLabel = target.revision;
        break;
      case "branch":
        diffArgs = ["diff", "--binary", `${target.base}...${target.head}`];
        nameArgs = ["diff", "--name-only", `${target.base}...${target.head}`];
        baseLabel = `${target.base}...${target.head}`;
        break;
      case "files":
        diffArgs = ["diff", "--binary", "HEAD", "--", ...target.paths];
        nameArgs = ["diff", "--name-only", "HEAD", "--", ...target.paths];
        baseLabel = "selected files";
        break;
    }

    let diff = await this.gitRaw(root, ...diffArgs);
    const changedFiles = (await this.gitRaw(root, ...nameArgs))
      .split("\n")
      .filter(Boolean);
    if (target.type === "working-tree" || target.type === "files") {
      const untracked = (
        await this.gitRaw(
          root,
          "ls-files",
          "-z",
          "--others",
          "--exclude-standard",
        )
      )
        .split("\0")
        .filter(Boolean)
        .filter(
          (file) =>
            target.type !== "files" ||
            target.paths.some(
              (selected) =>
                file === selected || file.startsWith(`${selected}/`),
            ),
        );
      for (const file of untracked) {
        if (!changedFiles.includes(file)) changedFiles.push(file);
        diff += await this.noIndexDiff(root, file);
      }
    }
    return {
      repositoryPath: root,
      baseLabel,
      diff,
      changedFiles,
      generatedAt: new Date().toISOString(),
    };
  }

  private async noIndexDiff(
    root: string,
    relativePath: string,
  ): Promise<string> {
    const absolute = path.resolve(root, relativePath);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error(`Unsafe review path: ${relativePath}`);
    }
    try {
      const diff = await this.gitRaw(
        root,
        "diff",
        "--no-index",
        "--binary",
        "/dev/null",
        absolute,
      );
      return this.normalizeNoIndexPaths(diff, absolute, relativePath);
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout;
      if (typeof stdout === "string") {
        return this.normalizeNoIndexPaths(stdout, absolute, relativePath);
      }
      throw error;
    }
  }

  private normalizeNoIndexPaths(
    diff: string,
    absolutePath: string,
    relativePath: string,
  ): string {
    const absoluteGitPath = absolutePath
      .split(path.sep)
      .join("/")
      .replace(/^\/+/, "");
    const relativeGitPath = relativePath.split(path.sep).join("/");
    return diff
      .replaceAll(`a/${absoluteGitPath}`, `a/${relativeGitPath}`)
      .replaceAll(`b/${absoluteGitPath}`, `b/${relativeGitPath}`);
  }

  private async git(cwd: string, ...args: string[]): Promise<string> {
    return (await this.gitRaw(cwd, ...args)).trim();
  }

  private async gitRaw(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  }
}
