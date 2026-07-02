import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentHookExecutor,
  ReviewFinding,
} from "@continuedev/agent-runtime";
import type {
  CreateReviewRequest,
  ReviewAnalyzer,
  ReviewFixResult,
  ReviewFindingComment,
  ReviewFindingFeedback,
  ReviewReport,
} from "./contracts.js";
import { GitReviewTargetResolver } from "./gitResolver.js";
import type { ReviewStore } from "./store.js";
import { ReviewStoreConflictError } from "./store.js";

export interface ReviewFixer {
  apply(repositoryPath: string, finding: ReviewFinding): Promise<void>;
  validate?(repositoryPath: string, finding: ReviewFinding): Promise<void>;
}

export class ReviewEngine {
  private readonly analyzers = new Map<string, ReviewAnalyzer>();
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly store: ReviewStore,
    private readonly resolver: GitReviewTargetResolver,
    analyzers: ReviewAnalyzer[],
    private readonly fixer?: ReviewFixer,
    private readonly hooks?: AgentHookExecutor,
  ) {
    for (const analyzer of analyzers) this.analyzers.set(analyzer.id, analyzer);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  async run(input: CreateReviewRequest): Promise<ReviewReport> {
    const now = new Date().toISOString();
    let report = await this.store.saveReport({
      id: input.request.id || randomUUID(),
      repositoryPath: path.resolve(input.repositoryPath),
      request: input.request,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      findings: [],
      analyzerIds: input.analyzerIds?.length
        ? input.analyzerIds
        : [...this.analyzers.keys()],
      revision: 0,
    });
    const controller = new AbortController();
    this.active.set(report.id, controller);
    report = await this.save(report, { status: "running" });
    try {
      await this.hooks?.run("review.before", { report });
      const source = await this.resolver.resolve(
        input.repositoryPath,
        input.request,
      );
      if (controller.signal.aborted) return this.requireReport(report.id);
      const selected = report.analyzerIds.map((id) => {
        const analyzer = this.analyzers.get(id);
        if (!analyzer)
          throw new Error(`Review analyzer ${id} is not registered`);
        return analyzer;
      });
      const batches = await Promise.all(
        selected.map((analyzer) =>
          controller.signal.aborted
            ? Promise.resolve([])
            : analyzer.analyze({
                request: input.request,
                source,
                signal: controller.signal,
              }),
        ),
      );
      if (controller.signal.aborted) return this.requireReport(report.id);
      const findings = this.deduplicate(
        batches.flat().map((finding) => ({
          ...finding,
          requestId: report.id,
        })),
      );
      report = await this.save(report, {
        status: "completed",
        findings,
        summary:
          findings.length === 0
            ? "No findings"
            : `${findings.length} finding${findings.length === 1 ? "" : "s"}`,
      });
      await this.hooks?.run("review.after", { report });
      return report;
    } catch (error) {
      if (controller.signal.aborted) {
        return this.requireReport(report.id);
      }
      const failed = await this.save(report, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      await this.hooks?.run("review.after", { report: failed });
      return failed;
    } finally {
      this.active.delete(report.id);
    }
  }

  async cancel(reportId: string): Promise<ReviewReport> {
    this.active.get(reportId)?.abort("user-canceled");
    const report = await this.requireReport(reportId);
    if (report.status === "canceled") return report;
    return this.save(report, { status: "canceled" });
  }

  getReport(reportId: string): Promise<ReviewReport | undefined> {
    return this.store.getReport(reportId);
  }

  listReports(): Promise<ReviewReport[]> {
    return this.store.listReports();
  }

  async setFindingStatus(
    reportId: string,
    findingId: string,
    status: ReviewFinding["status"],
  ): Promise<ReviewReport> {
    return this.updateFinding(reportId, findingId, (finding) => ({
      ...finding,
      status,
      updatedAt: new Date().toISOString(),
    }));
  }

  async addComment(
    findingId: string,
    body: string,
    author: ReviewFindingComment["author"] = "user",
  ): Promise<ReviewFindingComment> {
    const normalized = body.trim();
    if (!normalized) throw new Error("Review comment cannot be empty");
    const comment: ReviewFindingComment = {
      id: randomUUID(),
      findingId,
      body: normalized,
      author,
      createdAt: new Date().toISOString(),
    };
    await this.store.saveComment(comment);
    return comment;
  }

  listComments(findingId: string): Promise<ReviewFindingComment[]> {
    return this.store.listComments(findingId);
  }

  async setFeedback(
    findingId: string,
    value: ReviewFindingFeedback["value"],
  ): Promise<ReviewFindingFeedback> {
    const feedback: ReviewFindingFeedback = {
      findingId,
      value,
      createdAt: new Date().toISOString(),
    };
    await this.store.saveFeedback(feedback);
    return feedback;
  }

  async fixFinding(
    reportId: string,
    findingId: string,
    repositoryPath?: string,
  ): Promise<ReviewFixResult> {
    if (!this.fixer) throw new Error("Review autofix is not configured");
    const report = await this.requireReport(reportId);
    const finding = report.findings.find(
      (candidate) => candidate.id === findingId,
    );
    if (!finding) throw new Error(`Review finding ${findingId} does not exist`);
    const root = path.resolve(repositoryPath ?? report.repositoryPath);
    if (root !== path.resolve(report.repositoryPath)) {
      throw new Error("Review fixes must run in the reviewed repository");
    }
    await this.hooks?.run("edit.before", {
      report,
      finding,
      repositoryPath: root,
    });
    await this.fixer.apply(root, finding);
    await this.fixer.validate?.(root, finding);
    await this.hooks?.run("edit.after", {
      report,
      finding,
      repositoryPath: root,
    });
    const updated = await this.setFindingStatus(reportId, findingId, "fixed");
    const verification = await this.run({
      repositoryPath: root,
      request: { ...report.request, id: randomUUID() },
      analyzerIds: report.analyzerIds,
    });
    return { report: updated, verification };
  }

  async reanchor(reportId: string, findingId: string): Promise<ReviewFinding> {
    const report = await this.requireReport(reportId);
    const finding = report.findings.find(
      (candidate) => candidate.id === findingId,
    );
    if (!finding) throw new Error(`Review finding ${findingId} does not exist`);
    if (!finding.originalText) return finding;
    const absolute = path.resolve(report.repositoryPath, finding.filepath);
    if (
      !absolute.startsWith(`${path.resolve(report.repositoryPath)}${path.sep}`)
    ) {
      throw new Error(`Unsafe review finding path: ${finding.filepath}`);
    }
    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return finding;
      throw error;
    }
    const lines = content.split("\n");
    const matches = lines
      .map((line, index) => (line === finding.originalText ? index + 1 : -1))
      .filter((line) => line > 0);
    if (matches.length !== 1) return finding;
    const updated = await this.updateFinding(
      reportId,
      findingId,
      (candidate) => ({
        ...candidate,
        startLine: matches[0],
        endLine: candidate.endLine ? matches[0] : undefined,
        updatedAt: new Date().toISOString(),
      }),
    );
    return updated.findings.find((candidate) => candidate.id === findingId)!;
  }

  async reanchorReport(reportId: string): Promise<ReviewReport> {
    const report = await this.requireReport(reportId);
    for (const finding of report.findings) {
      await this.reanchor(reportId, finding.id);
    }
    return this.requireReport(reportId);
  }

  private deduplicate(findings: ReviewFinding[]): ReviewFinding[] {
    const seen = new Set<string>();
    return findings.filter((finding) => {
      const key =
        finding.fingerprint ??
        `${finding.filepath}:${finding.startLine}:${finding.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async updateFinding(
    reportId: string,
    findingId: string,
    update: (finding: ReviewFinding) => ReviewFinding,
  ): Promise<ReviewReport> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const report = await this.requireReport(reportId);
      if (!report.findings.some((finding) => finding.id === findingId)) {
        throw new Error(`Review finding ${findingId} does not exist`);
      }
      try {
        return await this.store.saveReport(
          {
            ...report,
            findings: report.findings.map((finding) =>
              finding.id === findingId ? update(finding) : finding,
            ),
            updatedAt: new Date().toISOString(),
          },
          report.revision,
        );
      } catch (error) {
        if (!(error instanceof ReviewStoreConflictError)) throw error;
      }
    }
    throw new ReviewStoreConflictError(reportId);
  }

  private async save(
    report: ReviewReport,
    update: Partial<ReviewReport>,
  ): Promise<ReviewReport> {
    let current = report;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.store.saveReport(
          { ...current, ...update, updatedAt: new Date().toISOString() },
          current.revision,
        );
      } catch (error) {
        if (!(error instanceof ReviewStoreConflictError)) throw error;
        current = await this.requireReport(report.id);
        if (current.status === "canceled" && update.status !== "canceled") {
          return current;
        }
      }
    }
    throw new ReviewStoreConflictError(report.id);
  }

  private async requireReport(reportId: string): Promise<ReviewReport> {
    const report = await this.store.getReport(reportId);
    if (!report) throw new Error(`Review report ${reportId} does not exist`);
    return report;
  }
}
