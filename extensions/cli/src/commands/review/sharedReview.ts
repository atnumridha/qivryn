import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ReviewRequest } from "@continuedev/agent-runtime";
import {
  DiffSafetyAnalyzer,
  FileReviewStore,
  GitReviewTargetResolver,
  GitPatchReviewFixer,
  ReviewEngine,
  type ReviewReport,
} from "@continuedev/review-engine";

export interface SharedReviewOptions {
  cwd?: string;
  target?: string;
  mode?: ReviewRequest["mode"];
  fix?: boolean;
}

export function parseReviewTarget(
  value = "working-tree",
): ReviewRequest["target"] {
  if (value === "working-tree") return { type: "working-tree" };
  if (value === "staged") return { type: "staged" };
  if (value.startsWith("commit:")) {
    return {
      type: "commit",
      revision: value.slice("commit:".length) || "HEAD",
    };
  }
  if (value.startsWith("branch:")) {
    const range = value.slice("branch:".length);
    const [base, head] = range.split("...");
    if (!base || !head)
      throw new Error("Branch targets use branch:<base>...<head>");
    return { type: "branch", base, head };
  }
  if (value.startsWith("files:")) {
    const paths = value
      .slice("files:".length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (paths.length === 0)
      throw new Error("File targets require at least one path");
    return { type: "files", paths };
  }
  if (value.startsWith("pr:"))
    return { type: "pull-request", url: value.slice(3) };
  throw new Error(`Unknown review target: ${value}`);
}

export async function runSharedReview(
  options: SharedReviewOptions = {},
): Promise<ReviewReport> {
  const globalDirectory =
    process.env.CONTINUE_GLOBAL_DIR ?? path.join(os.homedir(), ".continue");
  const engine = new ReviewEngine(
    new FileReviewStore(path.join(globalDirectory, "reviews")),
    new GitReviewTargetResolver(),
    [new DiffSafetyAnalyzer()],
    new GitPatchReviewFixer(),
  );
  await engine.initialize();
  let report = await engine.run({
    repositoryPath: path.resolve(options.cwd ?? process.cwd()),
    request: {
      id: randomUUID(),
      mode: options.mode ?? "standard",
      target: parseReviewTarget(options.target),
    },
  });
  if (options.fix) {
    for (const finding of report.findings.filter(
      (item) => item.proposedPatch,
    )) {
      const fixed = await engine.fixFinding(report.id, finding.id);
      report = fixed.verification;
    }
  }
  return report;
}

export function renderSharedReview(
  report: ReviewReport,
  format?: string,
): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    `Agent Review · ${report.request.mode} · ${report.status}`,
    `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}`,
  ];
  for (const finding of report.findings) {
    lines.push(
      "",
      `[${finding.severity.toUpperCase()}] ${finding.title}`,
      `${finding.filepath}:${finding.startLine}${finding.endLine ? `-${finding.endLine}` : ""}`,
      finding.body,
    );
    if (finding.evidence) lines.push(`  ${finding.evidence}`);
  }
  return lines.join("\n");
}
