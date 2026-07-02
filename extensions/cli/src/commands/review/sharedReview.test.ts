import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseReviewTarget,
  renderSharedReview,
  runSharedReview,
} from "./sharedReview.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("shared CLI review", () => {
  it("parses every local review target", () => {
    expect(parseReviewTarget()).toEqual({ type: "working-tree" });
    expect(parseReviewTarget("staged")).toEqual({ type: "staged" });
    expect(parseReviewTarget("commit:HEAD~1")).toEqual({
      type: "commit",
      revision: "HEAD~1",
    });
    expect(parseReviewTarget("branch:main...feature")).toEqual({
      type: "branch",
      base: "main",
      head: "feature",
    });
    expect(parseReviewTarget("files:a.ts,b.ts")).toEqual({
      type: "files",
      paths: ["a.ts", "b.ts"],
    });
    expect(parseReviewTarget("pr:https://example.test/pull/1")).toEqual({
      type: "pull-request",
      url: "https://example.test/pull/1",
    });
    expect(() => parseReviewTarget("branch:main")).toThrow(/branch:<base>/i);
  });

  it("uses the persisted IDE review format and renders text or JSON", async () => {
    const repository = await mkdtemp(
      path.join(os.tmpdir(), "qivryn-cli-review-"),
    );
    const state = await mkdtemp(path.join(os.tmpdir(), "qivryn-cli-state-"));
    roots.push(repository, state);
    await execFileAsync("git", ["-C", repository, "init", "-b", "main"]);
    await execFileAsync("git", [
      "-C",
      repository,
      "config",
      "user.email",
      "review@qivryn.ai",
    ]);
    await execFileAsync("git", [
      "-C",
      repository,
      "config",
      "user.name",
      "Qivryn Review",
    ]);
    await writeFile(
      path.join(repository, "app.ts"),
      "export const safe = true;\n",
    );
    await execFileAsync("git", ["-C", repository, "add", "."]);
    await execFileAsync("git", ["-C", repository, "commit", "-m", "initial"]);
    await writeFile(
      path.join(repository, "app.ts"),
      "const password = 'abcdefgh';\n",
    );
    vi.stubEnv("QIVRYN_GLOBAL_DIR", state);

    const report = await runSharedReview({ cwd: repository, mode: "deep" });
    expect(report.repositoryPath).toBe(repository);
    expect(report.request.mode).toBe("deep");
    expect(report.findings[0].title).toBe("Possible hard-coded credential");
    expect(renderSharedReview(report)).toContain("app.ts:1");
    expect(JSON.parse(renderSharedReview(report, "json")).id).toBe(report.id);
  });
});
