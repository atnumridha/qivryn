import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitWorktreeWorkspaceProvider } from "../src/gitWorktreeProvider.js";
import { ShadowWorkspaceValidator } from "../src/shadowWorkspace.js";
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(() =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("shadow workspace validation", () => {
  it("validates dirty state without touching the active workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "continue-shadow-"));
    roots.push(root);
    const repo = path.join(root, "repo");
    await exec("git", ["init", repo]);
    await writeFile(path.join(repo, "value.txt"), "base\n");
    await exec("git", ["-C", repo, "add", "-A"]);
    await exec("git", [
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "base",
    ]);
    await writeFile(path.join(repo, "value.txt"), "dirty\n");
    const validator = new ShadowWorkspaceValidator(
      new GitWorktreeWorkspaceProvider({
        rootDirectory: path.join(root, "worktrees"),
      }),
    );
    const result = await validator.validate(repo, process.execPath, [
      "-e",
      "const fs=require('fs'); if(fs.readFileSync('value.txt','utf8')!=='dirty\\n') process.exit(2)",
    ]);
    expect(result.exitCode).toBe(0);
    expect(await readFile(path.join(repo, "value.txt"), "utf8")).toBe(
      "dirty\n",
    );
  });
});
