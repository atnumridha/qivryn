import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewAnalyzer } from "../src/contracts.js";
import { DiffSafetyAnalyzer, SemanticDiffAnalyzer } from "../src/analyzers.js";
import { ReviewEngine } from "../src/engine.js";
import { FileReviewStore } from "../src/fileStore.js";
import { GitReviewTargetResolver } from "../src/gitResolver.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(root: string, ...args: string[]): Promise<string> {
  return (
    await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" })
  ).stdout.trim();
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-review-"));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "review@qivryn.ai");
  await git(root, "config", "user.name", "Qivryn Review");
  await writeFile(path.join(root, "app.ts"), "export const safe = true;\n");
  await writeFile(path.join(root, "other.ts"), "export const other = true;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");
  return root;
}

async function reviewState(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-review-state-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        import("node:fs/promises").then(({ rm }) =>
          rm(root, { recursive: true, force: true }),
        ),
      ),
  );
});

describe("GitReviewTargetResolver", () => {
  it("resolves working tree, staged, commit, branch, selected files, and pull requests", async () => {
    const root = await fixture();
    const resolver = new GitReviewTargetResolver({
      async resolve(repositoryPath, url) {
        return {
          repositoryPath,
          baseLabel: url,
          diff: "pull-request-diff",
          changedFiles: ["remote.ts"],
          generatedAt: new Date().toISOString(),
        };
      },
    });

    await writeFile(path.join(root, "app.ts"), "export const safe = false;\n");
    await writeFile(path.join(root, "new.ts"), "const token = 'abcdefgh';\n");
    const working = await resolver.resolve(root, {
      id: "working",
      mode: "standard",
      target: { type: "working-tree" },
    });
    expect(working.changedFiles).toEqual(
      expect.arrayContaining(["app.ts", "new.ts"]),
    );
    expect(working.diff).toContain("+++ b/new.ts");
    expect(working.diff).not.toContain(root.replace(/^\//, ""));

    await git(root, "add", "app.ts");
    const staged = await resolver.resolve(root, {
      id: "staged",
      mode: "fast",
      target: { type: "staged" },
    });
    expect(staged.changedFiles).toEqual(["app.ts"]);
    await git(root, "commit", "-m", "change app");
    const revision = await git(root, "rev-parse", "HEAD");
    expect(
      (
        await resolver.resolve(root, {
          id: "commit",
          mode: "deep",
          target: { type: "commit", revision },
        })
      ).changedFiles,
    ).toEqual(["app.ts"]);

    await git(root, "checkout", "-b", "feature");
    await writeFile(
      path.join(root, "other.ts"),
      "export const other = false;\n",
    );
    await git(root, "add", "other.ts");
    await git(root, "commit", "-m", "feature change");
    expect(
      (
        await resolver.resolve(root, {
          id: "branch",
          mode: "standard",
          target: { type: "branch", base: "main", head: "feature" },
        })
      ).changedFiles,
    ).toEqual(["other.ts"]);

    await writeFile(
      path.join(root, "app.ts"),
      "export const selected = true;\n",
    );
    await writeFile(
      path.join(root, "other.ts"),
      "export const excluded = true;\n",
    );
    const files = await resolver.resolve(root, {
      id: "files",
      mode: "standard",
      target: { type: "files", paths: ["app.ts"] },
    });
    expect(files.changedFiles).toEqual(["app.ts"]);

    const pullRequest = await resolver.resolve(root, {
      id: "pr",
      mode: "standard",
      target: { type: "pull-request", url: "https://example.test/pull/1" },
    });
    expect(pullRequest.diff).toBe("pull-request-diff");
  });
});

describe("ReviewEngine", () => {
  it("validates semantic model findings against added lines and patch scope", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "app.ts"),
      "export async function load() { return fetch('/api'); }\n",
    );
    const analyzer = new SemanticDiffAnalyzer(async () =>
      JSON.stringify([
        {
          severity: "error",
          title: "Response errors are ignored",
          body: "Check response.ok before using this request as successful.",
          filepath: "app.ts",
          startLine: 1,
          proposedPatch:
            "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export async function load() { return fetch('/api'); }\n+export async function load() { const response = await fetch('/api'); if (!response.ok) throw new Error('request failed'); return response; }\n",
        },
        {
          severity: "warning",
          title: "Invented unchanged issue",
          body: "This line is not in the diff.",
          filepath: "other.ts",
          startLine: 99,
        },
        {
          severity: "warning",
          title: "Cross-file patch",
          body: "The finding is valid but its patch escapes scope.",
          filepath: "app.ts",
          startLine: 1,
          proposedPatch:
            "diff --git a/other.ts b/other.ts\n--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-a\n+b\n",
        },
      ]),
    );
    const source = await new GitReviewTargetResolver().resolve(root, {
      id: "semantic-source",
      mode: "standard",
      target: { type: "working-tree" },
    });
    const findings = await analyzer.analyze({
      request: {
        id: "semantic",
        mode: "standard",
        target: { type: "working-tree" },
      },
      source,
      signal: new AbortController().signal,
    });
    expect(findings).toHaveLength(2);
    expect(findings[0].proposedPatch).toContain("diff --git a/app.ts b/app.ts");
    expect(findings[1].proposedPatch).toBeUndefined();
    expect(findings.every((finding) => finding.filepath === "app.ts")).toBe(
      true,
    );
  });

  it("keeps fast reviews deterministic without invoking the model", async () => {
    let invoked = false;
    const analyzer = new SemanticDiffAnalyzer(async () => {
      invoked = true;
      return "[]";
    });
    expect(
      await analyzer.analyze({
        request: {
          id: "fast",
          mode: "fast",
          target: { type: "working-tree" },
        },
        source: {
          repositoryPath: "/repo",
          baseLabel: "working tree",
          diff: "diff --git a/a.ts b/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+const a = 1;",
          changedFiles: ["a.ts"],
          generatedAt: new Date().toISOString(),
        },
        signal: new AbortController().signal,
      }),
    ).toEqual([]);
    expect(invoked).toBe(false);
  });

  it("persists structured findings and supports actions and reanchoring", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "app.ts"),
      "const apiKey = 'abcdefgh';\n<<<<<<< HEAD\n",
    );
    const store = new FileReviewStore(await reviewState());
    const engine = new ReviewEngine(store, new GitReviewTargetResolver(), [
      new DiffSafetyAnalyzer(),
    ]);
    await engine.initialize();
    const report = await engine.run({
      repositoryPath: root,
      request: {
        id: "review-1",
        mode: "standard",
        target: { type: "working-tree" },
      },
    });
    expect(report.status).toBe("completed");
    expect(report.repositoryPath).toBe(root);
    expect(report.findings.map((finding) => finding.title)).toEqual(
      expect.arrayContaining([
        "Possible hard-coded credential",
        "Unresolved merge conflict marker",
      ]),
    );

    const finding = report.findings[0];
    await engine.addComment(finding.id, "Please use the environment provider.");
    expect(await engine.listComments(finding.id)).toHaveLength(1);
    expect((await engine.setFeedback(finding.id, "up")).value).toBe("up");
    expect(
      (
        await engine.setFindingStatus(report.id, finding.id, "dismissed")
      ).findings.find((candidate) => candidate.id === finding.id)?.status,
    ).toBe("dismissed");

    await writeFile(
      path.join(root, "app.ts"),
      `// moved\n${await readFile(path.join(root, "app.ts"), "utf8")}`,
    );
    expect((await engine.reanchor(report.id, finding.id)).startLine).toBe(
      finding.startLine + 1,
    );
    expect((await engine.listReports())[0].id).toBe(report.id);
  });

  it("validates an autofix and performs a second review pass", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "app.ts"), "const token = 'abcdefgh';\n");
    let validated = false;
    const engine = new ReviewEngine(
      new FileReviewStore(await reviewState()),
      new GitReviewTargetResolver(),
      [new DiffSafetyAnalyzer()],
      {
        async apply(repositoryPath) {
          await writeFile(
            path.join(repositoryPath, "app.ts"),
            "const token = process.env.API_TOKEN;\n",
          );
        },
        async validate() {
          validated = true;
        },
      },
    );
    await engine.initialize();
    const report = await engine.run({
      repositoryPath: root,
      request: {
        id: "fix-review",
        mode: "deep",
        target: { type: "working-tree" },
      },
    });
    const result = await engine.fixFinding(report.id, report.findings[0].id);
    expect(validated).toBe(true);
    expect(result.report.findings[0].status).toBe("fixed");
    expect(result.verification.id).not.toBe(report.id);
    expect(result.verification.findings).toHaveLength(0);
  });

  it("cancels an active analyzer without a stale completion write", async () => {
    const root = await fixture();
    const blocking: ReviewAnalyzer = {
      id: "test.blocking",
      analyze: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve([]), { once: true });
        }),
    };
    const engine = new ReviewEngine(
      new FileReviewStore(await reviewState()),
      new GitReviewTargetResolver(),
      [blocking],
    );
    await engine.initialize();
    const running = engine.run({
      repositoryPath: root,
      request: {
        id: "cancel-review",
        mode: "fast",
        target: { type: "working-tree" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await engine.cancel("cancel-review")).status).toBe("canceled");
    expect((await running).status).toBe("canceled");
    expect((await engine.getReport("cancel-review"))?.status).toBe("canceled");
  });
});
